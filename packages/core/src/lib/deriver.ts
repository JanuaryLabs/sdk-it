import ts, { TypeFlags, symbolName } from 'typescript';

import { sortObjectKeys } from './utils.js';

type Collector = Record<string, any>;

/**
 * How literal values met while serializing collapse to their base type.
 * - none: keep every literal (top-level response objects).
 * - values: array items are representative, so literals read straight off an
 *   item's initializer collapse while declared literal types keep their values.
 * - all: const-asserted tuples collapse every literal.
 */
type LiteralWidening = 'none' | 'values' | 'all';

export const deriveSymbol = Symbol.for('serialize');
export const $types = Symbol.for('types');
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

export function nodeLocation(node: ts.Node): string | undefined {
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

export class TypeDeriver {
  public readonly collector: Collector = {};
  public readonly checker: ts.TypeChecker;
  public readonly typesMap: Record<string, string>;
  private trace: TraceContext = {};
  private currentNode?: ts.Node;
  private readonly activeAliases = new Map<ts.Type, boolean>();
  constructor(
    checker: ts.TypeChecker,
    typeMappings: Record<string, string> = defaultTypesMap,
  ) {
    this.checker = checker;
    this.typesMap = typeMappings;
  }

  setTrace(ctx: { file?: string; operation?: string }) {
    this.trace = { ...ctx };
  }

  private warn(message: string, node?: ts.Node) {
    const parts = [`\x1b[33m\u26a0 ${message}\x1b[0m`];
    const resolvedNode = node ?? this.currentNode;
    const location = resolvedNode ? nodeLocation(resolvedNode) : undefined;
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

  serializeType(type: ts.Type): any {
    return this.serialize(type, 'none');
  }

  private serialize(type: ts.Type, widening: LiteralWidening): unknown {
    const alias = type.aliasSymbol?.getName();
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

  private serializeResolved(type: ts.Type, widening: LiteralWidening): unknown {
    if (this.typesMap[type.aliasSymbol?.getName() || type.symbol?.getName()]) {
      return {
        [deriveSymbol]: true,
        optional: false,
        [$types]: [
          this.typesMap[type.aliasSymbol?.getName() || type.symbol?.getName()],
        ],
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
    if (type.flags & TypeFlags.Any) {
      return {
        [deriveSymbol]: true,
        optional: false,
        [$types]: [],
      };
    }
    if (type.flags & TypeFlags.Unknown) {
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
    if (type.isStringLiteral()) {
      return {
        [deriveSymbol]: true,
        optional: false,
        ...(widening === 'all' ? {} : { kind: 'literal', value: type.value }),
        [$types]: ['string'],
      };
    }
    if (type.isNumberLiteral()) {
      return {
        [deriveSymbol]: true,
        optional: false,
        ...(widening === 'all' ? {} : { kind: 'literal', value: type.value }),
        [$types]: ['number'],
      };
    }
    if (type.flags & TypeFlags.BooleanLiteral) {
      return {
        [deriveSymbol]: true,
        optional: false,
        ...(widening === 'all'
          ? {}
          : {
              kind: 'literal',
              value: this.checker.typeToString(type) === 'true',
            }),
        [$types]: ['boolean'],
      };
    }
    if (type.flags & TypeFlags.TemplateLiteral) {
      return {
        [deriveSymbol]: true,
        optional: false,
        [$types]: ['string'],
      };
    }
    if (type.flags & TypeFlags.String) {
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
    if (type.flags & ts.TypeFlags.Boolean) {
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
    if (type.isIntersection()) {
      let optional: boolean | undefined;
      const types: any[] = [];
      for (const intersectionType of type.types) {
        if (optional === undefined) {
          optional = (intersectionType.flags & ts.TypeFlags.Undefined) !== 0;
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
    if (type.isUnion()) {
      let optional: boolean | undefined;
      const types: any[] = [];
      for (const unionType of type.types) {
        if (optional === undefined) {
          // ignore undefined
          optional = (unionType.flags & ts.TypeFlags.Undefined) !== 0;
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
        ts.IndexKind.Number,
      );
      if (!elementType) {
        const typeName = type.symbol?.getName() || '<unknown>';
        this.warn(`Could not find element type for array type ${typeName}`);
        return {
          [deriveSymbol]: true,
          optional: false,
          kind: 'array',
          [$types]: ['any'],
        };
      }
      const mappedElementType =
        this.typesMap[
          elementType.aliasSymbol?.getName() || elementType.symbol?.getName()
        ];
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
    if (type.isClass()) {
      const declaration = type.symbol?.valueDeclaration;
      if (!declaration) {
        return {
          [deriveSymbol]: true,
          optional: false,
          [$types]: [type.symbol.getName()],
        };
      }
      return this.serializeNode(declaration);
    }
    if (type.symbol?.flags & ts.SymbolFlags.Interface) {
      const name = type.symbol.getName();
      if (!this.collector[name]) {
        this.collector[name] = {};
        const properties: Record<string, unknown> = {};
        for (const property of this.checker.getPropertiesOfType(type)) {
          properties[property.name] = this.serializeType(
            this.checker.getTypeOfSymbol(property),
          );
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
      if (this.typesMap[symbolName(type.symbol)]) {
        return {
          [deriveSymbol]: true,
          optional: false,
          [$types]: [this.typesMap[symbolName(type.symbol)]],
        };
      }
      const properties = this.checker.getPropertiesOfType(type);
      if (properties.length > 0) {
        const serializedProps: Record<string, any> = {};
        for (const prop of properties) {
          const declarations = prop.getDeclarations() ?? [];
          const propAssingment = declarations.find((it) =>
            ts.isPropertyAssignment(it),
          );
          const shorthand = declarations.find((it) =>
            ts.isShorthandPropertyAssignment(it),
          );
          const shorthandType = shorthand
            ? this.typeOfShorthand(shorthand)
            : undefined;
          // get literal properties values if any
          if (propAssingment) {
            serializedProps[prop.name] = this.serializeValue(
              this.typeOfExpression(propAssingment.initializer),
              widening,
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
      const declaration =
        type.symbol.valueDeclaration ?? type.symbol.declarations?.[0];
      if (!declaration) {
        return {
          [deriveSymbol]: true,
          optional: false,
          [$types]: [type.symbol.getName()],
        };
      }
      return this.serializeNode(declaration);
    }

    this.warn(`Unhandled type: ${type.flags} ${ts.TypeFlags[type.flags]}`);

    return {
      [deriveSymbol]: true,
      optional: false,
      [$types]: [
        this.checker.typeToString(
          type,
          undefined,
          ts.TypeFormatFlags.NoTruncation,
        ),
      ],
    };
  }

  private serializeValue(type: ts.Type, widening: LiteralWidening): unknown {
    const isLiteral =
      type.isLiteral() || (type.flags & TypeFlags.BooleanLiteral) !== 0;
    return this.serialize(
      type,
      widening === 'values' && isLiteral ? 'all' : widening,
    );
  }

  /**
   * Preserve the inferred type of `satisfies` expressions unless the operand is
   * an empty array; only then recover its declared element type.
   */
  private typeOfExpression(
    node: ts.Expression,
    seen = new Set<ts.Symbol>(),
  ): ts.Type {
    const satisfies = this.emptyArraySatisfies(node);
    if (satisfies) {
      return this.checker.getTypeFromTypeNode(satisfies.type);
    }
    let expression = node;
    while (ts.isParenthesizedExpression(expression)) {
      expression = expression.expression;
    }

    if (ts.isIdentifier(expression)) {
      const symbol = this.checker.getSymbolAtLocation(expression);
      const declaration = symbol?.valueDeclaration ?? symbol?.declarations?.[0];
      if (
        symbol &&
        !seen.has(symbol) &&
        declaration &&
        ts.isVariableDeclaration(declaration) &&
        ts.isVariableDeclarationList(declaration.parent) &&
        declaration.parent.flags & ts.NodeFlags.Const
      ) {
        seen.add(symbol);
        if (declaration.type) {
          return this.checker.getTypeFromTypeNode(declaration.type);
        }
        if (declaration.initializer) {
          return this.typeOfExpression(declaration.initializer, seen);
        }
      }
    }

    if (
      ts.isArrayLiteralExpression(expression) &&
      expression.elements.length === 1 &&
      ts.isSpreadElement(expression.elements[0])
    ) {
      return this.typeOfExpression(expression.elements[0].expression, seen);
    }

    return this.checker.getTypeAtLocation(expression);
  }

  private emptyArraySatisfies(
    node: ts.Expression,
  ): ts.SatisfiesExpression | undefined {
    let expression = node;
    while (ts.isParenthesizedExpression(expression)) {
      expression = expression.expression;
    }
    if (!ts.isSatisfiesExpression(expression)) {
      return undefined;
    }
    let operand = expression.expression;
    while (ts.isParenthesizedExpression(operand)) {
      operand = operand.expression;
    }
    if (!ts.isArrayLiteralExpression(operand) || operand.elements.length > 0) {
      return undefined;
    }
    const annotation = this.checker.getTypeFromTypeNode(expression.type);
    return this.checker.isArrayLikeType(annotation) ? expression : undefined;
  }

  private typeOfShorthand(
    node: ts.ShorthandPropertyAssignment,
  ): ts.Type | undefined {
    const symbol = this.checker.getShorthandAssignmentValueSymbol(node);
    const declaration = symbol?.valueDeclaration ?? symbol?.declarations?.[0];
    if (
      !declaration ||
      !ts.isVariableDeclaration(declaration) ||
      !declaration.initializer
    ) {
      return undefined;
    }
    return this.emptyArraySatisfies(declaration.initializer)
      ? this.typeOfExpression(declaration.initializer)
      : this.checker.getTypeAtLocation(node.name);
  }

  serializeNode(node: ts.Node): any {
    this.currentNode = node;
    if (ts.isObjectLiteralExpression(node)) {
      const symbolType = this.checker.getTypeAtLocation(node);
      const props: Record<string, any> = {};

      for (const prop of node.properties) {
        if (ts.isPropertyAssignment(prop)) {
          props[prop.name.getText()] = this.serializeType(
            this.typeOfExpression(prop.initializer),
          );
        } else if (ts.isShorthandPropertyAssignment(prop)) {
          const type = this.typeOfShorthand(prop);
          if (type) {
            props[prop.name.text] = this.serializeType(type);
          }
        }
      }

      for (const symbol of symbolType.getProperties()) {
        if (!Object.hasOwn(props, symbol.name)) {
          const type = this.checker.getTypeOfSymbol(symbol);
          props[symbol.name] = this.serializeType(type);
        }
      }

      return sortObjectKeys(props);
    }
    if (ts.isPropertyAccessExpression(node)) {
      const symbol = this.checker.getSymbolAtLocation(node.name);
      if (!symbol) {
        this.warn(`No symbol found for ${node.name.getText()}`, node);
        return null;
      }
      const type = this.checker.getTypeOfSymbol(symbol);
      return this.serializeType(type);
    }
    if (ts.isPropertySignature(node)) {
      const symbol = this.checker.getSymbolAtLocation(node.name);
      if (!symbol) {
        this.warn(`No symbol found for ${node.name.getText()}`, node);
        return null;
      }
      const type = this.checker.getTypeOfSymbol(symbol);
      return this.serializeType(type);
    }
    if (ts.isPropertyDeclaration(node)) {
      const symbol = this.checker.getSymbolAtLocation(node.name);
      if (!symbol) {
        this.warn(`No symbol found for ${node.name.getText()}`, node);
        return null;
      }
      const type = this.checker.getTypeOfSymbol(symbol);
      return this.serializeType(type);
    }
    if (ts.isInterfaceDeclaration(node)) {
      if (!node.name?.text) {
        throw new Error('Interface has no name');
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
        const members: Record<string, any> = {};
        for (const member of node.members.filter(ts.isPropertySignature)) {
          members[member.name.getText()] = this.serializeNode(member);
        }
        this.collector[node.name.text] = sortObjectKeys(members);
      }
      return {
        [deriveSymbol]: true,
        optional: false,
        [$types]: [`#/components/schemas/${node.name.text}`],
      };
    }
    if (ts.isClassDeclaration(node)) {
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
        for (const member of node.members.filter(ts.isPropertyDeclaration)) {
          members[member.name!.getText()] = this.serializeNode(member);
        }
        this.collector[node.name.text] = sortObjectKeys(members);
      }
      return {
        [deriveSymbol]: true,
        optional: false,
        [$types]: [`#/components/schemas/${node.name.text}`],
        $ref: `#/components/schemas/${node.name.text}`,
      };
    }
    if (ts.isVariableDeclaration(node)) {
      const symbol = this.checker.getSymbolAtLocation(node.name);
      if (!symbol) {
        this.warn(`No symbol found for ${node.name.getText()}`, node);
        return null;
      }
      if (!node.type) {
        this.warn(`No type found for ${node.name.getText()}`, node);
        return 'any';
      }
      const type = this.checker.getTypeFromTypeNode(node.type);
      return this.serializeType(type);
    }
    if (ts.isIdentifier(node)) {
      const symbol = this.checker.getSymbolAtLocation(node);
      if (!symbol) {
        this.warn(`No symbol found for identifier ${node.getText()}`, node);
        return null;
      }
      const type = this.typeOfExpression(node);
      return this.serializeType(type);
    }
    if (ts.isAwaitExpression(node)) {
      const type = this.checker.getTypeAtLocation(node);
      return this.serializeType(type);
    }
    if (ts.isCallExpression(node)) {
      const type = this.checker.getTypeAtLocation(node);
      return this.serializeType(type);
    }
    if (ts.isAsExpression(node)) {
      const type = this.checker.getTypeAtLocation(node);
      return this.serializeType(type);
    }
    if (ts.isSatisfiesExpression(node)) {
      return this.serializeType(this.typeOfExpression(node));
    }
    if (ts.isTypeLiteralNode(node)) {
      const symbolType = this.checker.getTypeAtLocation(node);
      const props: Record<string, unknown> = {};
      for (const symbol of symbolType.getProperties()) {
        const type = this.checker.getTypeOfSymbol(symbol);
        props[symbol.name] = this.serializeType(type);
      }
      return {
        [deriveSymbol]: true,
        optional: false,
        [$types]: [sortObjectKeys(props)],
      };
    }
    if (node.kind === ts.SyntaxKind.NullKeyword) {
      return {
        [deriveSymbol]: true,
        optional: false,
        [$types]: ['null'],
      };
    }
    if (node.kind === ts.SyntaxKind.BooleanKeyword) {
      return {
        [deriveSymbol]: true,
        optional: false,
        [$types]: ['boolean'],
      };
    }
    if (node.kind === ts.SyntaxKind.TrueKeyword) {
      return {
        [deriveSymbol]: true,
        optional: false,
        kind: 'literal',
        value: true,
        [$types]: ['boolean'],
      };
    }
    if (node.kind === ts.SyntaxKind.FalseKeyword) {
      return {
        [deriveSymbol]: true,
        optional: false,
        kind: 'literal',
        value: false,
        [$types]: ['boolean'],
      };
    }
    if (ts.isFunctionDeclaration(node)) {
      if (!node.name) {
        this.warn('Function declaration has no name', node);
        return {
          [deriveSymbol]: true,
          optional: false,
          [$types]: ['any'],
        };
      }

      const functionName = node.name.text;
      if (this.typesMap[functionName]) {
        return {
          [deriveSymbol]: true,
          optional: false,
          [$types]: [this.typesMap[functionName]],
        };
      }

      if (node.type) {
        const returnType = this.checker.getTypeFromTypeNode(node.type);
        return this.serializeType(returnType);
      }

      return {
        [deriveSymbol]: true,
        optional: false,
        [$types]: ['any'],
      };
    }
    if (ts.isArrayLiteralExpression(node)) {
      const type = this.typeOfExpression(node);
      return this.serializeType(type);
    }
    if (ts.isStringLiteral(node) || ts.isNumericLiteral(node)) {
      const type = this.checker.getTypeAtLocation(node);
      return this.serializeType(type);
    }
    // Handle template literals in expression position
    if (
      ts.isTemplateExpression(node) ||
      ts.isNoSubstitutionTemplateLiteral(node)
    ) {
      const type = this.checker.getTypeAtLocation(node);
      return this.serializeType(type);
    }
    if (ts.isTaggedTemplateExpression(node)) {
      const type = this.checker.getTypeAtLocation(node);
      return this.serializeType(type);
    }

    // Handle binary expressions (||, &&, +, -, etc.)
    if (ts.isBinaryExpression(node)) {
      const type = this.checker.getTypeAtLocation(node);
      return this.serializeType(type);
    }

    // Handle conditional/ternary expressions (x ? y : z)
    if (ts.isConditionalExpression(node)) {
      const type = this.checker.getTypeAtLocation(node);
      return this.serializeType(type);
    }

    // Handle parenthesized expressions ((value))
    if (ts.isParenthesizedExpression(node)) {
      return this.serializeType(this.typeOfExpression(node));
    }

    // Handle non-null assertions (value!)
    if (ts.isNonNullExpression(node)) {
      const type = this.checker.getTypeAtLocation(node);
      return this.serializeType(type);
    }

    this.warn(
      `Unhandled node: ${ts.SyntaxKind[node.kind]} "${node.getText()}" (type: ${this.checker.typeToString(
        this.checker.getTypeAtLocation(node),
        undefined,
        ts.TypeFormatFlags.NoTruncation,
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
