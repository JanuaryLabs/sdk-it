import ts, { TypeFlags, symbolName } from 'typescript';

type Collector = Record<string, any>;
export const deriveSymbol = Symbol.for('serialize');
export const $types = Symbol.for('types');
const defaults: Record<string, string> = {
  Readable: 'any',
  ReadableStream: 'any',
  DateConstructor: 'string',
  ArrayBufferConstructor: 'any',
  SharedArrayBufferConstructor: 'any',
  Int8ArrayConstructor: 'any',
  Uint8Array: 'any',
};
export class TypeDeriver {
  public readonly collector: Collector = {};
  public readonly checker: ts.TypeChecker;
  constructor(checker: ts.TypeChecker) {
    this.checker = checker;
  }

  serializeType(type: ts.Type): any {
    const indexType = type.getStringIndexType();
    if (indexType) {
      return {
        [deriveSymbol]: true,
        kind: 'record',
        optional: false,
        [$types]: [this.serializeType(indexType)],
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
    if (type.isStringLiteral()) {
      return {
        [deriveSymbol]: true,
        optional: false,
        kind: 'literal',
        value: type.value,
        [$types]: ['string'],
      };
    }
    if (type.isNumberLiteral()) {
      return {
        [deriveSymbol]: true,
        optional: false,
        kind: 'literal',
        value: type.value,
        [$types]: ['number'],
      };
    }
    if (type.flags & TypeFlags.BooleanLiteral) {
      return {
        [deriveSymbol]: true,
        optional: false,
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
        optional: true,
        [$types]: ['null'],
      };
    }
    if (type.isIntersection()) {
      let optional: boolean | undefined;
      const types: any[] = [];
      for (const unionType of type.types) {
        if (optional === undefined) {
          optional = (unionType.flags & ts.TypeFlags.Undefined) !== 0;
          if (optional) {
            continue;
          }
        }

        types.push(this.serializeType(unionType));
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

        types.push(this.serializeType(unionType));
      }
      return {
        [deriveSymbol]: true,
        kind: 'union',
        optional,
        [$types]: types,
      };
    }
    if (this.checker.isArrayLikeType(type)) {
      const [argType] = this.checker.getTypeArguments(type as ts.TypeReference);
      if (!argType) {
        const typeName = type.symbol?.getName() || '<unknown>';
        console.warn(
          `Could not find generic type argument for array type ${typeName}`,
        );
        return {
          [deriveSymbol]: true,
          optional: false,
          kind: 'array',
          [$types]: ['any'],
        };
      }
      const typeSymbol = argType.getSymbol();
      if (!typeSymbol) {
        return {
          [deriveSymbol]: true,
          optional: false,
          kind: 'array',
          [$types]: [this.serializeType(argType)],
        };
      }

      if (typeSymbol.valueDeclaration) {
        return {
          kind: 'array',
          [deriveSymbol]: true,
          [$types]: [this.serializeNode(typeSymbol.valueDeclaration)],
        };
      }
      const maybeDeclaration = typeSymbol.declarations?.[0];
      if (maybeDeclaration) {
        if (ts.isMappedTypeNode(maybeDeclaration)) {
          const resolvedType = this.checker
            .getPropertiesOfType(argType)
            .reduce<Record<string, unknown>>((acc, prop) => {
              const propType = this.checker.getTypeOfSymbol(prop);
              acc[prop.name] = this.serializeType(propType);
              return acc;
            }, {});
          return {
            kind: 'array',
            optional: false,
            [deriveSymbol]: true,
            [$types]: [resolvedType],
          };
        } else {
          return {
            kind: 'array',
            ...this.serializeNode(maybeDeclaration),
          };
        }
      }

      return {
        kind: 'array',
        optional: false,
        [deriveSymbol]: true,
        [$types]: ['any'],
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
    if (isInterfaceType(type)) {
      const valueDeclaration =
        type.symbol.valueDeclaration ?? type.symbol.declarations?.[0];
      if (!valueDeclaration) {
        return {
          [deriveSymbol]: true,
          optional: false,
          [$types]: [type.symbol.getName()],
        };
      }
      return this.serializeNode(valueDeclaration);
    }
    if (type.flags & TypeFlags.Object) {
      if (defaults[symbolName(type.symbol)]) {
        return {
          [deriveSymbol]: true,
          optional: false,
          [$types]: [defaults[type.symbol.name]],
        };
      }
      const properties = this.checker.getPropertiesOfType(type);
      if (properties.length > 0) {
        const serializedProps: Record<string, any> = {};
        for (const prop of properties) {
          const propAssingment = (prop.getDeclarations() ?? []).find((it) =>
            ts.isPropertyAssignment(it),
          );
          // get literal properties values if any
          if (propAssingment) {
            const type = this.checker.getTypeAtLocation(
              propAssingment.initializer,
            );
            serializedProps[prop.name] = this.serializeType(type);
          }
          if (
            (prop.getDeclarations() ?? []).find((it) =>
              ts.isPropertySignature(it),
            )
          ) {
            const propType = this.checker.getTypeOfSymbol(prop);
            serializedProps[prop.name] = this.serializeType(propType);
          }
        }
        return {
          [deriveSymbol]: true,
          kind: 'object',
          optional: false,
          [$types]: [serializedProps],
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
    console.warn(`Unhandled type: ${type.flags} ${ts.TypeFlags[type.flags]}`);

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

  serializeNode(node: ts.Node): any {
    if (ts.isObjectLiteralExpression(node)) {
      const symbolType = this.checker.getTypeAtLocation(node);
      const props: Record<string, any> = {};
      for (const symbol of symbolType.getProperties()) {
        const type = this.checker.getTypeOfSymbol(symbol);
        props[symbol.name] = this.serializeType(type);
      }

      // get literal properties values if any
      for (const prop of node.properties) {
        if (ts.isPropertyAssignment(prop)) {
          const type = this.checker.getTypeAtLocation(prop.initializer);
          props[prop.name.getText()] = this.serializeType(type);
        }
      }

      return props;
    }
    if (ts.isPropertyAccessExpression(node)) {
      const symbol = this.checker.getSymbolAtLocation(node.name);
      if (!symbol) {
        console.warn(`No symbol found for ${node.name.getText()}`);
        return null;
      }
      const type = this.checker.getTypeOfSymbol(symbol);
      return this.serializeType(type);
    }
    if (ts.isPropertySignature(node)) {
      const symbol = this.checker.getSymbolAtLocation(node.name);
      if (!symbol) {
        console.warn(`No symbol found for ${node.name.getText()}`);
        return null;
      }
      const type = this.checker.getTypeOfSymbol(symbol);
      return this.serializeType(type);
    }
    if (ts.isPropertyDeclaration(node)) {
      const symbol = this.checker.getSymbolAtLocation(node.name);
      if (!symbol) {
        console.warn(`No symbol found for ${node.name.getText()}`);
        return null;
      }
      const type = this.checker.getTypeOfSymbol(symbol);
      return this.serializeType(type);
    }
    if (ts.isInterfaceDeclaration(node)) {
      if (!node.name?.text) {
        throw new Error('Interface has no name');
      }
      if (defaults[node.name.text]) {
        return {
          [deriveSymbol]: true,
          optional: false,
          [$types]: [defaults[node.name.text]],
        };
      }
      if (!this.collector[node.name.text]) {
        this.collector[node.name.text] = {};
        const members: Record<string, any> = {};
        for (const member of node.members.filter(ts.isPropertySignature)) {
          members[member.name.getText()] = this.serializeNode(member);
        }
        this.collector[node.name.text] = members;
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
      if (defaults[node.name.text]) {
        return {
          [deriveSymbol]: true,
          optional: false,
          [$types]: [defaults[node.name.text]],
        };
      }

      if (!this.collector[node.name.text]) {
        this.collector[node.name.text] = {};
        const members: Record<string, unknown> = {};
        for (const member of node.members.filter(ts.isPropertyDeclaration)) {
          members[member.name!.getText()] = this.serializeNode(member);
        }
        this.collector[node.name.text] = members;
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
        console.warn(`No symbol found for ${node.name.getText()}`);
        return null;
      }
      if (!node.type) {
        console.warn(`No type found for ${node.name.getText()}`);
        return 'any';
      }
      const type = this.checker.getTypeFromTypeNode(node.type);
      return this.serializeType(type);
    }
    if (ts.isIdentifier(node)) {
      const symbol = this.checker.getSymbolAtLocation(node);
      if (!symbol) {
        console.warn(`Identifer: No symbol found for ${node.getText()}`);
        return null;
      }
      const type = this.checker.getTypeAtLocation(node);
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
        [$types]: [props],
      };
    }
    if (node.kind === ts.SyntaxKind.NullKeyword) {
      return {
        [deriveSymbol]: true,
        optional: true,
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
    if (ts.isArrayLiteralExpression(node)) {
      const type = this.checker.getTypeAtLocation(node);
      return this.serializeType(type);
    }

    console.warn(`Unhandled node: ${ts.SyntaxKind[node.kind]} ${node.flags}`);
    return {
      [deriveSymbol]: true,
      optional: false,
      [$types]: ['any'],
    };
  }
}

function isInterfaceType(type: ts.Type): boolean {
  if (type.isClassOrInterface()) {
    // Check if it's an interface
    return !!(type.symbol.flags & ts.SymbolFlags.Interface);
  }
  return false;
}
