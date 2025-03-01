import ts, { TypeFlags, couldStartTrivia } from 'typescript';

type Collector = Record<string, any>;
export const deriveSymbol = Symbol.for('serialize');
export const $types = Symbol.for('types');

export class TypeDeriver {
  public readonly collector: Collector = {};
  public readonly checker: ts.TypeChecker;
  constructor(checker: ts.TypeChecker) {
    this.checker = checker;
  }

  serializeType(type: ts.Type): any {
    if (type.flags & TypeFlags.Any) {
      return {
        [deriveSymbol]: true,
        optional: false,
        [$types]: [],
      };
    }
    if (type.flags & TypeFlags.Object) {
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
    if (type.isUnion() || type.isIntersection()) {
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
        console.warn(
          `No symbol found for array type ${this.checker.typeToString(argType)}`,
        );
        const typeString = this.checker.typeToString(argType);
        return {
          [deriveSymbol]: true,
          optional: false,
          kind: 'array',
          [$types]: typeString === 'undefined' ? [] : [typeString],
        };
      }

      if (typeSymbol.valueDeclaration) {
        return {
          kind: 'array',
          ...this.serializeNode(typeSymbol.valueDeclaration),
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
    // if (type.isLiteral()) {
    // 	const baseType = this.checker.getBaseTypeOfLiteralType(type);
    // 	return {
    // 		optional: false,
    // 		[typesSymbol]: [checker.typeToString(baseType)],
    // 	};
    // }
    return {
      [deriveSymbol]: true,
      optional: false,
      [$types]: [this.checker.typeToString(type)],
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
      return props;
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
      const defaults: Record<string, string> = {
        ReadableStream: 'ReadableStream',
        DateConstructor: 'Date',
      };
      if (defaults[node.name.text]) {
        return {
          [deriveSymbol]: true,
          optional: false,
          [$types]: [`#/components/schemas/${node.name.text}`],
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
      if (!this.collector[node.name.text]) {
        this.collector[node.name.text] = {};
        const members: Record<string, any> = {};
        for (const member of node.members.filter(ts.isPropertyDeclaration)) {
          members[member.name!.getText()] = this.serializeNode(member);
        }
        this.collector[node.name.text] = members;
      }
      return {
        [deriveSymbol]: true,
        optional: false,
        [$types]: [node.name.text],
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
        console.warn(`No symbol found for ${node.getText()}`);
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

    if (node.kind === ts.SyntaxKind.NullKeyword) {
      return {
        [deriveSymbol]: true,
        optional: true,
        [$types]: ['null'],
      };
    }
   if (ts.isTypeLiteralNode(node)) {
      const symbolType = this.checker.getTypeAtLocation(node);
      const props: Record<string, any> = {};
      for (const symbol of symbolType.getProperties()) {
        const type = this.checker.getTypeOfSymbol(symbol);
        props[symbol.name] = this.serializeType(type);
      }
      return props;
    }

    // if (ts.isNewExpression(node)) {
    //   // check if name is Pagination
    //   if(ts.isIdentifier(node.expression) && node.expression.text === 'Pagination') {
    //     // hint for pagination
    //     return {
    //       [serializeSymbol]: true,
    //       optional: false,
    //       [typesSymbol]: ['Pagination'],
    //     }
    //   }
    // }
    console.log(`Unhandled node: ${ts.SyntaxKind[node.kind]}`);
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
