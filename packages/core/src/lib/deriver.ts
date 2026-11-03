import {
  type Expression,
  type Node,
  NodeFlags,
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
  type Checker,
  IndexKind,
  ObjectFlags,
  SymbolFlags,
  type Symbol as TsSymbol,
  type Type,
  TypeFlags,
  TypeFormatFlags,
} from '@typescript/native/sync';

import { $types, deriveSymbol } from './derived-type.js';
import { sortObjectKeys } from './utils.js';

type Collector = Record<string, any>;

/**
 * How literal values met while serializing collapse to their base type.
 * - none: keep every literal (top-level response objects).
 * - values: array items are representative, so literals read straight off an
 *   item's initializer collapse while declared literal types and
 *   property-level `as const` values keep their literals.
 * - all: const-asserted tuples collapse every literal.
 */
type LiteralWidening = 'none' | 'values' | 'all';

export const defaultTypesMap: Record<string, string> = {
  Readable: 'any',
  ReadableStream: 'any',
  DateConstructor: 'string',
  ArrayBufferConstructor: 'any',
  SharedArrayBufferConstructor: 'any',
  Int8ArrayConstructor: 'any',
  Uint8Array: 'any',
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

function skipParentheses(node: Expression): Expression {
  let expression = node;
  while (isParenthesizedExpression(expression)) {
    expression = expression.expression;
  }
  return expression;
}

function isConstTypeReference(node: TypeNode): boolean {
  return (
    isTypeReferenceNode(node) &&
    isIdentifier(node.typeName) &&
    node.typeName.text === 'const' &&
    !node.typeArguments
  );
}

export class TypeDeriver {
  public readonly collector: Collector = {};
  public readonly checker: Checker;
  public readonly typesMap: Record<string, string>;
  private trace: TraceContext = {};
  private readonly activeAliases = new Map<Type, boolean>();
  constructor(
    checker: Checker,
    typeMappings: Record<string, string> = defaultTypesMap,
  ) {
    this.checker = checker;
    this.typesMap = typeMappings;
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
    const mappedType = typeName ? this.typesMap[typeName] : undefined;
    if (mappedType) {
      return {
        [deriveSymbol]: true,
        optional: false,
        [$types]: [mappedType],
      };
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
      const elementTypeName =
        elementType.getAliasSymbol()?.name || elementType.getSymbol()?.name;
      const mappedElementType = elementTypeName
        ? this.typesMap[elementTypeName]
        : undefined;
      const itemWidening: LiteralWidening =
        widening === 'all' || this.checker.isTupleType(type) ? 'all' : 'values';
      return {
        kind: 'array',
        optional: false,
        [deriveSymbol]: true,
        [$types]: mappedElementType
          ? [mappedElementType]
          : [this.serialize(elementType, itemWidening)],
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
      const name = symbol.name;
      if (!this.collector[name]) {
        this.collector[name] = {};
        const properties: Record<string, unknown> = {};
        for (const property of this.checker.getPropertiesOfType(type)) {
          const propertyType = this.checker.getTypeOfSymbol(property);
          if (!this.hasNoJsonForm(propertyType)) {
            properties[property.name] = this.serializeType(propertyType);
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
      if (symbol && this.typesMap[symbol.name]) {
        return {
          [deriveSymbol]: true,
          optional: false,
          [$types]: [this.typesMap[symbol.name]],
        };
      }
      const properties = this.checker
        .getPropertiesOfType(type)
        .filter(
          (prop) => !this.hasNoJsonForm(this.checker.getTypeOfSymbol(prop)),
        );
      if (properties.length > 0) {
        const serializedProps: Record<string, any> = {};
        for (const prop of properties) {
          const propAssingment = prop.declarations
            .find(isPropertyAssignment.Handle)
            ?.resolve();
          const shorthand = prop.declarations
            .find(isShorthandPropertyAssignment.Handle)
            ?.resolve();
          const shorthandType = shorthand
            ? this.typeOfShorthand(shorthand)
            : undefined;
          // get literal properties values if any
          if (propAssingment) {
            serializedProps[prop.name] = this.serializeValue(
              this.typeOfExpression(propAssingment.initializer),
              this.isConstAsserted(propAssingment.initializer)
                ? 'none'
                : widening,
            );
          } else if (shorthandType) {
            serializedProps[prop.name] = this.serializeValue(
              shorthandType,
              widening,
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

  serializeNode(node: Node): any {
    if (isObjectLiteralExpression(node)) {
      const symbolType = this.checker.getTypeAtLocation(node);
      const props: Record<string, any> = {};

      const dropped = new Set<string>();
      for (const prop of node.properties) {
        if (isPropertyAssignment(prop)) {
          const type = this.typeOfExpression(prop.initializer);
          if (this.hasNoJsonForm(type)) {
            dropped.add(prop.name.getText());
          } else {
            props[prop.name.getText()] = this.serializeType(type);
          }
        } else if (isShorthandPropertyAssignment(prop)) {
          const type = this.typeOfShorthand(prop);
          if (type) {
            if (this.hasNoJsonForm(type)) {
              dropped.add(prop.name.getText());
            } else {
              props[prop.name.getText()] = this.serializeType(type);
            }
          }
        }
      }

      for (const symbol of symbolType.getProperties()) {
        if (!Object.hasOwn(props, symbol.name) && !dropped.has(symbol.name)) {
          const type = this.checker.getTypeOfSymbol(symbol);
          if (!this.hasNoJsonForm(type)) {
            props[symbol.name] = this.serializeType(type);
          }
        }
      }

      return sortObjectKeys(props);
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
      if (this.typesMap[node.name.text]) {
        return {
          [deriveSymbol]: true,
          optional: false,
          [$types]: [this.typesMap[node.name.text]],
        };
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
    if (
      isAwaitExpression(node) ||
      isCallExpression(node) ||
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
