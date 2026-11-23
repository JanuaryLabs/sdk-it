import {
  type CallExpression,
  type Expression,
  type Node,
  NodeFlags,
  type ObjectLiteralExpression,
  type SatisfiesExpression,
  type ShorthandPropertyAssignment,
  SyntaxKind,
  type TypeNode,
} from '@typescript/native/ast';
import {
  isArrayLiteralExpression,
  isAsExpression,
  isAwaitExpression,
  isBinaryExpression,
  isCallExpression,
  isClassDeclaration,
  isConditionalExpression,
  isExpression,
  isIdentifier,
  isNewExpression,
  isNoSubstitutionTemplateLiteral,
  isNonNullExpression,
  isNumericLiteral,
  isObjectLiteralExpression,
  isParenthesizedExpression,
  isPropertyAccessExpression,
  isPropertyAssignment,
  isPropertyDeclaration,
  isSatisfiesExpression,
  isShorthandPropertyAssignment,
  isSpreadElement,
  isStringLiteral,
  isTaggedTemplateExpression,
  isTemplateExpression,
  isTypeAssertion,
  isTypeReferenceNode,
  isVariableDeclaration,
  isVariableDeclarationList,
} from '@typescript/native/ast/is';
import {
  CheckFlags,
  type Checker,
  ElementFlags,
  IndexKind,
  ObjectFlags,
  SymbolFlags,
  type Symbol as TsSymbol,
  type Type,
  TypeFlags,
  TypeFormatFlags,
} from '@typescript/native/sync';
import { hash } from 'node:crypto';
import type { SchemaObject } from 'openapi3-ts/oas31';

import { $types, deriveSymbol } from './derived-type.js';
import type { ThrownBinding } from './thrown.js';
import { sortObjectKeys } from './utils.js';

type Collector = Record<string, any>;

/** The length past which a component name is cut and hashed, so a generator's file name for it fits a file system's limit. */
const maxComponentNameLength = 64;

/**
 * How literal values met while serializing collapse to their base type.
 * - none: keep every literal (top-level response objects).
 * - values: array items are representative, so literals read straight off an
 *   item's initializer collapse while declared literal types and
 *   property-level `as const` values keep their literals.
 * - all: const-asserted tuples collapse every literal.
 */
type LiteralWidening = 'none' | 'values' | 'all';

/** JSON.stringify writes a Set or a Map as {}, whatever it holds. */
const emptyObject: SchemaObject = {
  type: 'object',
  properties: {},
  required: [],
  additionalProperties: false,
};

/** The JSON Schema each of these types stands for, under any mappings a caller adds. */
const defaultTypes: Readonly<Record<string, SchemaObject>> = {
  Set: emptyObject,
  ReadonlySet: emptyObject,
  Map: emptyObject,
  ReadonlyMap: emptyObject,
  Readable: {},
  ReadableStream: {},
  DateConstructor: { type: 'string' },
  ArrayBufferConstructor: {},
  SharedArrayBufferConstructor: {},
  Int8ArrayConstructor: {},
  Uint8Array: {},
};

interface TraceContext {
  file?: string;
  operation?: string;
}

function declarationOf(symbol: TsSymbol | undefined): Node | undefined {
  return (symbol?.valueDeclaration ?? symbol?.declarations[0])?.resolve();
}

export function nodeLocation(node: Node): string | undefined {
  try {
    const sourceFile = node.getSourceFile();
    if (!sourceFile) return undefined;
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(
      node.getStart(),
    );
    return `${sourceFile.fileName}:${line + 1}:${character + 1}`;
  } catch {
    return undefined;
  }
}

/** `node` without the parentheses around it. */
export function skipParentheses(node: Expression): Expression {
  let expression = node;
  while (isParenthesizedExpression(expression)) {
    expression = expression.expression;
  }
  return expression;
}

/** A literal value, serialized as a literal type of it serializes. */
function serializeLiteral(value: string | number) {
  return {
    [deriveSymbol]: true,
    optional: false,
    kind: 'literal',
    value,
    [$types]: [typeof value],
  };
}

function isConstTypeReference(node: TypeNode): boolean {
  return (
    isTypeReferenceNode(node) &&
    isIdentifier(node.typeName) &&
    node.typeName.text === 'const' &&
    !node.typeArguments
  );
}

/**
 * A response whose type the checker could not resolve, such as one read from a
 * module that does not exist. Its schema would be any, so derivation stops.
 */
export class UnresolvedTypeError extends Error {
  readonly operation: string | undefined;
  readonly location: string | undefined;
  constructor(operation: string | undefined, location: string | undefined) {
    super(
      `${operation ? `${operation}: ` : ''}the response${location ? ` at ${location}` : ''} has a type that does not resolve, so its schema would be any`,
    );
    this.name = 'UnresolvedTypeError';
    this.operation = operation;
    this.location = location;
  }
}

export class TypeDeriver {
  public readonly collector: Collector = {};
  public readonly checker: Checker;
  readonly #types: Readonly<Record<string, SchemaObject>>;
  private trace: TraceContext = {};
  private readonly activeAliases = new Map<Type, boolean>();
  /** The component name of each generic interface instantiation, by type id. */
  private readonly instantiationNames = new Map<number, string>();
  /** The ids of the members the global Error declares (name, message, stack, cause). */
  readonly #errorMembers: ReadonlySet<number>;
  /** `types`: a TypeScript type name and the JSON Schema written in its place, added onto the defaults. */
  constructor(
    checker: Checker,
    types?: Readonly<Record<string, SchemaObject>>,
  ) {
    this.checker = checker;
    this.#types = { ...defaultTypes, ...types };
    const error = checker.resolveName(
      'Error',
      SymbolFlags.Type,
      undefined,
      false,
    );
    this.#errorMembers = new Set(
      error
        ? checker
            .getPropertiesOfType(checker.getDeclaredTypeOfSymbol(error))
            .map(({ id }) => id)
        : [],
    );
  }

  /** The derived form of a mapped type: its schema, written as given. */
  #mapped(schema: SchemaObject) {
    return {
      [deriveSymbol]: true,
      kind: 'schema',
      optional: false,
      [$types]: [schema],
    };
  }

  setTrace(ctx: { file?: string; operation?: string }) {
    this.trace = { ...ctx };
  }

  /**
   * A function or class value: JSON.stringify drops it as a member and writes
   * nothing for it alone. An optional one (`fn?: () => void`) is a union with
   * undefined and is dropped the same way.
   */
  private hasNoJsonForm(type: Type): boolean {
    if (type.isUnionType()) {
      return type
        .getTypes()
        .every(
          (member) =>
            (member.flags & TypeFlags.Undefined) !== 0 ||
            this.hasNoJsonForm(member),
        );
    }
    return (
      type.getCallSignatures().length > 0 ||
      type.getConstructSignatures().length > 0
    );
  }

  /**
   * A member keyed by a symbol, such as [Symbol.toStringTag], which
   * JSON.stringify skips. TypeScript names it __@<name>@<id>, and escapes a
   * string key that starts with __ to ___, so the prefix is exact.
   */
  private keyedBySymbol(property: TsSymbol): boolean {
    return property.escapedName.startsWith('__@');
  }

  /**
   * A member the global Error declares (name, message, stack, cause), which
   * JSON.stringify never writes: the Error constructor defines message and
   * cause as non-enumerable own properties, and name and stack are not own
   * enumerable ones either. A subclass that declares such a member again
   * gets its own symbol, and its field is written.
   */
  private declaredByError(property: TsSymbol): boolean {
    return this.#errorMembers.has(property.id);
  }

  /** Whether JSON.stringify writes a member: not one keyed by a symbol, holding a function, or declared by Error. */
  private writesMember(property: TsSymbol): boolean {
    return (
      !this.keyedBySymbol(property) &&
      !this.declaredByError(property) &&
      !this.hasNoJsonForm(this.checker.getTypeOfSymbol(property))
    );
  }

  /**
   * Whether a type names a type parameter, as the type of `this.field` does in
   * the body of a generic class: such a type is the declaration's, and only
   * an instantiation of it says what the value is.
   */
  private mentionsTypeVariable(type: Type, seen = new Set<number>()): boolean {
    if (seen.has(type.id)) {
      return false;
    }
    seen.add(type.id);
    if (type.flags & (TypeFlags.InstantiableNonPrimitive | TypeFlags.Index)) {
      return true;
    }
    if (type.isUnionType() || type.isIntersectionType()) {
      return type
        .getTypes()
        .some((member) => this.mentionsTypeVariable(member, seen));
    }
    if (!type.isObjectType()) {
      return false;
    }
    const typeArguments = [
      ...(type.getAliasTypeArguments() ?? []),
      ...(type.isTypeReference() ? this.checker.getTypeArguments(type) : []),
    ];
    if (typeArguments.length > 0) {
      return typeArguments.some((argument) =>
        this.mentionsTypeVariable(argument, seen),
      );
    }
    return (
      (type.objectFlags & ObjectFlags.Anonymous) !== 0 &&
      this.checker
        .getPropertiesOfType(type)
        .some((property) =>
          this.mentionsTypeVariable(
            this.checker.getTypeOfSymbol(property),
            seen,
          ),
        )
    );
  }

  /**
   * Whether a tuple may be a const assertion's list of values, whose literals
   * then collapse to their base types. A const assertion lists each element
   * and has no alias, so a tuple with an alias, a rest or an optional element
   * is a declared type, and its literals stay, as in NonEmpty<'a' | 'b'>.
   */
  private listsConstValues(type: Type): boolean {
    return (
      type.isTupleType() &&
      !type.getAliasSymbol() &&
      type
        .getTarget()
        .elementFlags.every((flags) => (flags & ElementFlags.Required) !== 0)
    );
  }

  /**
   * A method called on a union receiver, such as `reading.toJSON()` on
   * `Recommendation | NoRecommendation`, returns what the member it runs on
   * returns. The checker reduces those returns to a common supertype, which
   * drops each member's own fields, so each member's return is read instead.
   * An undefined or null member, which only an optional call (`?.`) allows,
   * returns nothing. Only a method with one signature and no type parameters
   * returns the same whatever the arguments; for any other, the checker's
   * resolution of the call stands.
   */
  private serializeUnionReceiverCall(node: CallExpression): unknown {
    if (!isPropertyAccessExpression(node.expression)) {
      return undefined;
    }
    const receiver = this.checker.getTypeAtLocation(node.expression.expression);
    if (!receiver.isUnionType()) {
      return undefined;
    }
    let optional = false;
    const returns = new Map<number, Type>();
    for (const member of receiver.getTypes()) {
      if (member.flags & (TypeFlags.Undefined | TypeFlags.Null)) {
        optional = true;
        continue;
      }
      const method = this.checker.getPropertyOfType(
        member,
        node.expression.name.text,
      );
      const signatures = method
        ? this.checker.getTypeOfSymbol(method).getCallSignatures()
        : [];
      const signature = signatures.length === 1 ? signatures[0] : undefined;
      if (!signature || signature.getTypeParameters().length > 0) {
        return undefined;
      }
      const returned = this.checker.getReturnTypeOfSignature(signature);
      returns.set(returned.id, returned);
    }
    return {
      [deriveSymbol]: true,
      kind: 'union',
      optional,
      [$types]: [...returns.values()].map((returned) =>
        this.serializeType(returned),
      ),
    };
  }

  private warn(message: string, node?: Node) {
    const parts = [`\x1b[33m\u26a0 ${message}\x1b[0m`];
    const location = node ? nodeLocation(node) : undefined;
    if (location) {
      parts.push(`  at \x1b[36m${location}\x1b[0m`);
    } else if (this.trace.file) {
      parts.push(`  at \x1b[36m${this.trace.file}\x1b[0m`);
    }
    if (this.trace.operation) {
      parts.push(`  in \x1b[2m${this.trace.operation}\x1b[0m`);
    }
    console.warn(parts.join('\n'));
  }

  /**
   * The component name of an interface. A generic interface's instantiation has
   * its own members, so each one is its own component: one whose type arguments
   * are all its type parameters' defaults keeps the interface's name, as
   * UIMessage does, and any other is named after its type arguments, so
   * Box<'x'> is Box_x. A name past maxComponentNameLength is cut at a word and
   * ends with a hash of the instantiation's full spelling, so it stays a
   * usable file name and two instantiations that share the cut text keep
   * their own names whichever a route meets first. A name that another type
   * holds takes the first free numeric suffix.
   */
  private componentNameOf(type: Type, name: string): string {
    if (!type.isTypeReference()) {
      return name;
    }
    const typeArguments = this.checker.getTypeArguments(type);
    if (typeArguments.length === 0) {
      return name;
    }
    const known = this.instantiationNames.get(type.id);
    if (known) {
      return known;
    }
    const typeParameters = type.getTarget().getTypeParameters();
    const defaulted = typeArguments.every(
      (argument, index) =>
        typeParameters[index]?.getDefault()?.id === argument.id,
    );
    let base = name;
    if (!defaulted) {
      const spelling = [
        name,
        ...typeArguments.map((argument) =>
          this.checker.typeToString(
            argument,
            undefined,
            TypeFormatFlags.NoTruncation,
          ),
        ),
      ].join('_');
      base = spelling.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      if (base.length > maxComponentNameLength) {
        const digest = hash('sha256', spelling).slice(0, 8);
        const room = maxComponentNameLength - digest.length - 1;
        const cut = base.lastIndexOf('_', room);
        base = `${base.slice(0, cut > 0 ? cut : room)}_${digest}`;
      }
    }
    const taken = new Set([
      ...Object.keys(this.collector),
      ...this.instantiationNames.values(),
    ]);
    let component = base;
    for (let suffix = 2; taken.has(component); suffix++) {
      component = `${base}_${suffix}`;
    }
    this.instantiationNames.set(type.id, component);
    return component;
  }

  serializeType(type: Type): any {
    return this.serialize(type, 'none');
  }

  private serialize(type: Type, widening: LiteralWidening): unknown {
    const alias = type.getAliasSymbol()?.name;
    if (!alias) {
      return this.serializeResolved(type, widening);
    }
    if (this.activeAliases.has(type)) {
      this.activeAliases.set(type, true);
      return {
        [deriveSymbol]: true,
        optional: false,
        [$types]: [`#/components/schemas/${alias}`],
      };
    }

    this.activeAliases.set(type, false);
    try {
      const result = this.serializeResolved(type, widening);
      if (this.activeAliases.get(type)) {
        this.collector[alias] = result;
      }
      return result;
    } finally {
      this.activeAliases.delete(type);
    }
  }

  private serializeResolved(type: Type, widening: LiteralWidening): unknown {
    const symbol = type.getSymbol();
    const typeName = type.getAliasSymbol()?.name || symbol?.name;
    const mappedType = typeName ? this.#types[typeName] : undefined;
    if (mappedType) {
      return this.#mapped(mappedType);
    }
    if (symbol?.name === 'Date') {
      return {
        [deriveSymbol]: true,
        kind: 'date',
        optional: false,
        [$types]: ['string'],
      };
    }
    const indexType = type.getStringIndexType();
    if (indexType) {
      return {
        [deriveSymbol]: true,
        kind: 'record',
        optional: false,
        [$types]: [this.serialize(indexType, widening)],
      };
    }
    if (type.isErrorType()) {
      throw new UnresolvedTypeError(this.trace.operation, undefined);
    }
    if (type.flags & (TypeFlags.Any | TypeFlags.Unknown)) {
      return {
        [deriveSymbol]: true,
        optional: false,
        [$types]: [],
      };
    }
    if (type.flags & (TypeFlags.Never | TypeFlags.Undefined)) {
      return {
        [deriveSymbol]: true,
        kind: 'never',
        optional: (type.flags & TypeFlags.Undefined) !== 0,
        [$types]: [],
      };
    }
    if (type.isStringLiteralType()) {
      return {
        [deriveSymbol]: true,
        optional: false,
        ...(widening === 'all' ? {} : { kind: 'literal', value: type.value }),
        [$types]: ['string'],
      };
    }
    if (type.isNumberLiteralType()) {
      return {
        [deriveSymbol]: true,
        optional: false,
        ...(widening === 'all' ? {} : { kind: 'literal', value: type.value }),
        [$types]: ['number'],
      };
    }
    if (type.isBooleanLiteralType()) {
      return {
        [deriveSymbol]: true,
        optional: false,
        ...(widening === 'all' ? {} : { kind: 'literal', value: type.value }),
        [$types]: ['boolean'],
      };
    }
    if (type.flags & (TypeFlags.TemplateLiteral | TypeFlags.String)) {
      return {
        [deriveSymbol]: true,
        optional: false,
        [$types]: ['string'],
      };
    }
    if (type.flags & TypeFlags.Number) {
      return {
        [deriveSymbol]: true,
        optional: false,
        [$types]: ['number'],
      };
    }
    if (type.flags & TypeFlags.Boolean) {
      return {
        [deriveSymbol]: true,
        optional: false,
        [$types]: ['boolean'],
      };
    }
    if (type.flags & TypeFlags.Null) {
      return {
        [deriveSymbol]: true,
        optional: false,
        [$types]: ['null'],
      };
    }
    if (type.isIntersectionType()) {
      let optional: boolean | undefined;
      const types: any[] = [];
      for (const intersectionType of type.getTypes()) {
        if (optional === undefined) {
          optional = (intersectionType.flags & TypeFlags.Undefined) !== 0;
          if (optional) {
            continue;
          }
        }

        types.push(this.serialize(intersectionType, widening));
      }
      return {
        [deriveSymbol]: true,
        kind: 'intersection',
        optional,
        [$types]: types,
      };
    }
    if (type.isUnionType()) {
      let optional: boolean | undefined;
      const types: any[] = [];
      for (const unionType of type.getTypes()) {
        if (optional === undefined) {
          // ignore undefined
          optional = (unionType.flags & TypeFlags.Undefined) !== 0;
          if (optional) {
            continue;
          }
        }

        types.push(this.serialize(unionType, widening));
      }
      return {
        [deriveSymbol]: true,
        kind: 'union',
        optional,
        [$types]: types,
      };
    }
    if (this.checker.isArrayLikeType(type)) {
      const elementType = this.checker.getIndexTypeOfType(
        type,
        IndexKind.Number,
      );
      if (!elementType) {
        const typeName = symbol?.name || '<unknown>';
        this.warn(
          `Could not find element type for array type ${typeName}`,
          declarationOf(symbol),
        );
        return {
          [deriveSymbol]: true,
          optional: false,
          kind: 'array',
          [$types]: ['any'],
        };
      }
      const itemWidening: LiteralWidening =
        widening === 'all' || this.listsConstValues(type) ? 'all' : 'values';
      return {
        kind: 'array',
        optional: false,
        [deriveSymbol]: true,
        [$types]: [this.serialize(elementType, itemWidening)],
      };
    }
    if (this.hasNoJsonForm(type)) {
      return {
        [deriveSymbol]: true,
        kind: 'never',
        optional: true,
        [$types]: [],
      };
    }
    if (type.isObjectType() && type.objectFlags & ObjectFlags.Class) {
      const declaration = symbol?.valueDeclaration?.resolve();
      if (!declaration) {
        return {
          [deriveSymbol]: true,
          optional: false,
          [$types]: [symbol?.name],
        };
      }
      return this.serializeNode(declaration);
    }
    if (symbol && symbol.flags & SymbolFlags.Interface) {
      const name = this.componentNameOf(type, symbol.name);
      if (!this.collector[name]) {
        this.collector[name] = {};
        const properties: Record<string, unknown> = {};
        for (const property of this.checker.getPropertiesOfType(type)) {
          if (this.writesMember(property)) {
            properties[property.name] = this.serializeType(
              this.checker.getTypeOfSymbol(property),
            );
          }
        }
        this.collector[name] = sortObjectKeys(properties);
      }
      return {
        [deriveSymbol]: true,
        optional: false,
        [$types]: [`#/components/schemas/${name}`],
      };
    }
    if (type.flags & TypeFlags.Object) {
      const mappedObject = symbol ? this.#types[symbol.name] : undefined;
      if (mappedObject) {
        return this.#mapped(mappedObject);
      }
      const properties = this.checker
        .getPropertiesOfType(type)
        .filter((prop) => this.writesMember(prop));
      if (properties.length > 0) {
        const serializedProps: Record<string, any> = {};
        for (const prop of properties) {
          // A mapped type's property, such as z.infer's, carries its source
          // property's declarations, whose initializers hold the source's
          // values (a z.object() shape's ZodOptional), so only its type
          // describes it.
          const declarations =
            prop.checkFlags & CheckFlags.Mapped ? [] : prop.declarations;
          const propAssingment = declarations
            .find(isPropertyAssignment.Handle)
            ?.resolve();
          const shorthand = declarations
            .find(isShorthandPropertyAssignment.Handle)
            ?.resolve();
          // A value's own type keeps its literals. One written in a generic
          // body names type parameters, so the property's instantiated type
          // stands in for it.
          let valueType: Type | undefined;
          if (propAssingment) {
            valueType = this.typeOfExpression(propAssingment.initializer);
          } else if (shorthand) {
            valueType = this.typeOfShorthand(shorthand);
          }
          if (valueType && !this.mentionsTypeVariable(valueType)) {
            serializedProps[prop.name] = this.serializeValue(
              valueType,
              propAssingment && this.isConstAsserted(propAssingment.initializer)
                ? 'none'
                : widening,
            );
          } else {
            const propType = this.checker.getTypeOfSymbol(prop);
            serializedProps[prop.name] = this.serializeType(propType);
          }
        }
        return {
          [deriveSymbol]: true,
          kind: 'object',
          optional: false,
          [$types]: [sortObjectKeys(serializedProps)],
        };
      }
      // A mapped type whose keys come from a type parameter (zod's
      // { [P in keyof T]?: Issue[] } inside a generic function) has no
      // properties of its own: it is a record of its template type.
      if (type.isMappedType()) {
        return {
          [deriveSymbol]: true,
          kind: 'record',
          optional: false,
          [$types]: [this.serialize(type.getTemplateType(), widening)],
        };
      }
      return {
        [deriveSymbol]: true,
        kind: 'object',
        optional: false,
        [$types]: [{}],
      };
    }

    this.warn(
      `Unhandled type: ${type.flags} ${TypeFlags[type.flags]}`,
      declarationOf(symbol),
    );

    return {
      [deriveSymbol]: true,
      optional: false,
      [$types]: [
        this.checker.typeToString(
          type,
          undefined,
          TypeFormatFlags.NoTruncation,
        ),
      ],
    };
  }

  private serializeValue(type: Type, widening: LiteralWidening): unknown {
    return this.serialize(
      type,
      widening === 'values' && type.isLiteralType() ? 'all' : widening,
    );
  }

  /**
   * Preserve the inferred type of `satisfies` expressions unless the operand is
   * an empty array; only then recover its declared element type.
   */
  private typeOfExpression(node: Expression, seen = new Set<TsSymbol>()): Type {
    const satisfies = this.emptyArraySatisfies(node);
    if (satisfies) {
      return this.checker.getTypeFromTypeNode(satisfies.type);
    }
    const expression = skipParentheses(node);

    if (isIdentifier(expression)) {
      const symbol = this.checker.getSymbolAtLocation(expression);
      const declaration = (
        symbol?.valueDeclaration ?? symbol?.declarations[0]
      )?.resolve();
      if (
        symbol &&
        !seen.has(symbol) &&
        declaration &&
        isVariableDeclaration(declaration) &&
        isVariableDeclarationList(declaration.parent) &&
        declaration.parent.flags & NodeFlags.Const
      ) {
        seen.add(symbol);
        const narrowed = this.checker.getTypeAtLocation(expression);
        if (narrowed !== this.checker.getTypeAtLocation(declaration.name)) {
          return narrowed;
        }
        if (declaration.type) {
          return this.checker.getTypeFromTypeNode(declaration.type);
        }
        if (declaration.initializer) {
          return this.typeOfExpression(declaration.initializer, seen);
        }
      }
    }

    if (
      isArrayLiteralExpression(expression) &&
      expression.elements.length === 1 &&
      isSpreadElement(expression.elements[0])
    ) {
      return this.typeOfExpression(expression.elements[0].expression, seen);
    }

    return this.checker.getTypeAtLocation(expression);
  }

  private isConstAsserted(node: Expression): boolean {
    const expression = skipParentheses(node);
    return (
      (isAsExpression(expression) || isTypeAssertion(expression)) &&
      isConstTypeReference(expression.type)
    );
  }

  private emptyArraySatisfies(
    node: Expression,
  ): SatisfiesExpression | undefined {
    const expression = skipParentheses(node);
    if (!isSatisfiesExpression(expression)) {
      return undefined;
    }
    const operand = skipParentheses(expression.expression);
    if (!isArrayLiteralExpression(operand) || operand.elements.length > 0) {
      return undefined;
    }
    const annotation = this.checker.getTypeFromTypeNode(expression.type);
    return this.checker.isArrayLikeType(annotation) ? expression : undefined;
  }

  private typeOfShorthand(node: ShorthandPropertyAssignment): Type | undefined {
    const symbol = this.checker.getShorthandAssignmentValueSymbol(node);
    const declaration = (
      symbol?.valueDeclaration ?? symbol?.declarations[0]
    )?.resolve();
    if (
      !declaration ||
      !isVariableDeclaration(declaration) ||
      !declaration.initializer
    ) {
      return undefined;
    }
    return this.emptyArraySatisfies(declaration.initializer)
      ? this.typeOfExpression(declaration.initializer)
      : this.checker.getTypeAtLocation(node.name);
  }

  /**
   * The schema of what `node` sends. With a binding, `node` is in an error
   * handler and a read of a member off its error parameter stands for what the
   * bound throw site gives that member; only the parts that read the error
   * parameter are read by node, so everything else serializes as without one.
   */
  serializeNode(node: Node, binding?: ThrownBinding): any {
    try {
      return binding?.readsError(node)
        ? this.serializeBound(node, binding)
        : this.serializeNodeType(node);
    } catch (error) {
      // The innermost node whose type does not resolve names the place.
      if (error instanceof UnresolvedTypeError && !error.location) {
        throw new UnresolvedTypeError(
          error.operation,
          nodeLocation(node) ?? this.trace.file,
        );
      }
      throw error;
    }
  }

  private serializeBound(node: Node, binding: ThrownBinding): any {
    const local = binding.localConst(node);
    if (local) {
      return this.serializeNode(local.initializer, local.binding);
    }
    if (binding.isError(node)) {
      return this.serializeType(binding.site.type);
    }
    const name = binding.memberRead(node);
    if (name !== undefined) {
      const member = binding.member(name);
      if (!member) {
        return this.serializeNodeType(node);
      }
      switch (member.kind) {
        case 'type':
          return this.serializeType(member.type);
        case 'literal':
          return serializeLiteral(member.value);
        case 'expression':
          return this.serializeNode(member.expression);
      }
    }
    if (isParenthesizedExpression(node)) {
      return this.serializeNode(node.expression, binding);
    }
    if (isConditionalExpression(node)) {
      const taken = binding.decide(node.condition);
      if (taken !== undefined) {
        return this.serializeNode(
          taken ? node.whenTrue : node.whenFalse,
          binding,
        );
      }
    }
    if (isObjectLiteralExpression(node)) {
      return this.serializeObjectLiteral(node, binding);
    }
    return this.serializeNodeType(node);
  }

  /**
   * What a property's value serializes from: its type, or, for an object
   * literal that reads the bound error, its serialized form.
   */
  private propertyValue(
    initializer: Expression,
    binding: ThrownBinding | undefined,
  ): { type: Type } | { serialized: unknown } {
    if (!binding?.readsError(initializer)) {
      return { type: this.typeOfExpression(initializer) };
    }
    const expression = skipParentheses(initializer);
    const local = binding.localConst(expression);
    if (local) {
      return this.propertyValue(local.initializer, local.binding);
    }
    if (binding.isError(expression)) {
      return { type: binding.site.type };
    }
    const name = binding.memberRead(expression);
    if (name !== undefined) {
      const member = binding.member(name);
      if (!member) {
        return { type: this.typeOfExpression(expression) };
      }
      switch (member.kind) {
        case 'type':
          return { type: member.type };
        case 'literal':
          return { serialized: serializeLiteral(member.value) };
        case 'expression':
          return { type: this.typeOfExpression(member.expression) };
      }
    }
    if (isConditionalExpression(expression)) {
      const taken = binding.decide(expression.condition);
      if (taken !== undefined) {
        return this.propertyValue(
          taken ? expression.whenTrue : expression.whenFalse,
          binding,
        );
      }
    }
    if (isObjectLiteralExpression(expression)) {
      return {
        serialized: {
          [deriveSymbol]: true,
          kind: 'object',
          optional: false,
          [$types]: [this.serializeObjectLiteral(expression, binding)],
        },
      };
    }
    return { type: this.typeOfExpression(initializer) };
  }

  /**
   * The properties a spread that reads the bound error adds, and the names a
   * spread the site does not take leaves out: `...(cond && { … })`.
   */
  private boundSpread(
    expression: Expression,
    binding: ThrownBinding,
  ): { props: Record<string, unknown>; dropped: string[] } | undefined {
    const spread = skipParentheses(expression);
    const local = binding.localConst(spread);
    if (local) {
      return this.boundSpread(local.initializer, local.binding);
    }
    if (isObjectLiteralExpression(spread)) {
      return {
        props: this.serializeObjectLiteral(spread, binding),
        dropped: [],
      };
    }
    if (isConditionalExpression(spread)) {
      const taken = binding.decide(spread.condition);
      return taken === undefined
        ? undefined
        : this.boundSpread(taken ? spread.whenTrue : spread.whenFalse, binding);
    }
    if (
      isBinaryExpression(spread) &&
      spread.operatorToken.kind === SyntaxKind.AmpersandAmpersandToken
    ) {
      const taken = binding.decide(spread.left);
      if (taken === true) {
        return this.boundSpread(spread.right, binding);
      }
      if (taken === false) {
        return {
          props: {},
          dropped: this.checker
            .getPropertiesOfType(this.checker.getTypeAtLocation(spread.right))
            .map(({ name }) => name),
        };
      }
    }
    return undefined;
  }

  private serializeObjectLiteral(
    node: ObjectLiteralExpression,
    binding?: ThrownBinding,
  ): Record<string, any> {
    const symbolType = this.checker.getTypeAtLocation(node);
    const props: Record<string, any> = {};

    const dropped = new Set<string>();
    const assign = (
      name: string,
      value: { type: Type } | { serialized: unknown },
    ) => {
      if ('serialized' in value) {
        props[name] = value.serialized;
      } else if (this.hasNoJsonForm(value.type)) {
        dropped.add(name);
      } else {
        props[name] = this.serializeType(value.type);
      }
    };
    for (const prop of node.properties) {
      if (isPropertyAssignment(prop)) {
        assign(
          prop.name.getText(),
          this.propertyValue(prop.initializer, binding),
        );
      } else if (isShorthandPropertyAssignment(prop)) {
        const local = binding?.localConst(prop);
        if (local) {
          assign(
            prop.name.getText(),
            this.propertyValue(local.initializer, local.binding),
          );
        } else {
          const type = this.typeOfShorthand(prop);
          if (type) {
            assign(prop.name.getText(), { type });
          }
        }
      } else if (prop.kind === SyntaxKind.SpreadAssignment) {
        const bound = binding?.readsError(prop.expression)
          ? this.boundSpread(prop.expression, binding)
          : undefined;
        if (bound) {
          for (const name of bound.dropped) {
            if (!Object.hasOwn(props, name)) {
              dropped.add(name);
            }
          }
          for (const [name, value] of Object.entries(bound.props)) {
            dropped.delete(name);
            props[name] = value;
          }
          continue;
        }
        // A spread reads its source as a variable does, so a const object's
        // literals survive the copy; a later property still overrides them.
        const source = this.serializeType(
          this.typeOfExpression(prop.expression),
        );
        if (source?.kind === 'object') {
          for (const [name, value] of Object.entries(source[$types][0])) {
            dropped.delete(name);
            props[name] = value;
          }
        }
      }
    }

    for (const symbol of symbolType.getProperties()) {
      if (
        !this.keyedBySymbol(symbol) &&
        !Object.hasOwn(props, symbol.name) &&
        !dropped.has(symbol.name)
      ) {
        const type = this.checker.getTypeOfSymbol(symbol);
        if (!this.hasNoJsonForm(type)) {
          props[symbol.name] = this.serializeType(type);
        }
      }
    }

    return sortObjectKeys(props);
  }

  private serializeNodeType(node: Node): any {
    if (isObjectLiteralExpression(node)) {
      return this.serializeObjectLiteral(node);
    }
    if (isPropertyAccessExpression(node) || isPropertyDeclaration(node)) {
      const symbol = this.checker.getSymbolAtLocation(node.name);
      if (!symbol) {
        this.warn(`No symbol found for ${node.name.getText()}`, node);
        return null;
      }
      const type = this.checker.getTypeOfSymbol(symbol);
      return this.serializeType(type);
    }
    if (isClassDeclaration(node)) {
      if (!node.name?.text) {
        throw new Error('Class has no name');
      }
      const mappedClass = this.#types[node.name.text];
      if (mappedClass) {
        return this.#mapped(mappedClass);
      }

      if (!this.collector[node.name.text]) {
        this.collector[node.name.text] = {};
        const members: Record<string, unknown> = {};
        for (const member of node.members.filter(isPropertyDeclaration)) {
          const symbol = this.checker.getSymbolAtLocation(member.name);
          if (
            symbol &&
            this.hasNoJsonForm(this.checker.getTypeOfSymbol(symbol))
          ) {
            continue;
          }
          members[member.name!.getText()] = this.serializeNode(member);
        }
        this.collector[node.name.text] = sortObjectKeys(members);
      }
      return {
        [deriveSymbol]: true,
        optional: false,
        [$types]: [`#/components/schemas/${node.name.text}`],
      };
    }
    if (isIdentifier(node)) {
      const symbol = this.checker.getSymbolAtLocation(node);
      if (!symbol) {
        this.warn(`No symbol found for identifier ${node.getText()}`, node);
        return null;
      }
      const type = this.typeOfExpression(node);
      return this.serializeType(type);
    }
    if (isCallExpression(node)) {
      return (
        this.serializeUnionReceiverCall(node) ??
        this.serializeType(this.checker.getTypeAtLocation(node))
      );
    }
    if (
      isAwaitExpression(node) ||
      isNewExpression(node) ||
      isAsExpression(node)
    ) {
      return this.serializeType(this.checker.getTypeAtLocation(node));
    }
    if (isSatisfiesExpression(node)) {
      return this.serializeType(this.typeOfExpression(node));
    }
    if (node.kind === SyntaxKind.NullKeyword) {
      return {
        [deriveSymbol]: true,
        optional: false,
        [$types]: ['null'],
      };
    }
    if (node.kind === SyntaxKind.TrueKeyword) {
      return {
        [deriveSymbol]: true,
        optional: false,
        kind: 'literal',
        value: true,
        [$types]: ['boolean'],
      };
    }
    if (node.kind === SyntaxKind.FalseKeyword) {
      return {
        [deriveSymbol]: true,
        optional: false,
        kind: 'literal',
        value: false,
        [$types]: ['boolean'],
      };
    }
    if (isArrayLiteralExpression(node)) {
      const type = this.typeOfExpression(node);
      return this.serializeType(type);
    }
    if (
      isStringLiteral(node) ||
      isNumericLiteral(node) ||
      isTemplateExpression(node) ||
      isNoSubstitutionTemplateLiteral(node) ||
      isTaggedTemplateExpression(node) ||
      isBinaryExpression(node) ||
      isConditionalExpression(node)
    ) {
      return this.serializeType(this.checker.getTypeAtLocation(node));
    }
    if (isParenthesizedExpression(node)) {
      return this.serializeType(this.typeOfExpression(node));
    }
    if (isNonNullExpression(node)) {
      return this.serializeType(this.checker.getTypeAtLocation(node));
    }
    if (isExpression(node)) {
      return this.serializeType(this.typeOfExpression(node));
    }

    this.warn(
      `Unhandled node: ${SyntaxKind[node.kind]} "${node.getText()}" (type: ${this.checker.typeToString(
        this.checker.getTypeAtLocation(node),
        undefined,
        TypeFormatFlags.NoTruncation,
      )})`,
      node,
    );

    return {
      [deriveSymbol]: true,
      optional: false,
      [$types]: ['any'],
    };
  }
}
