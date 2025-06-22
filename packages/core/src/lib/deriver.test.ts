import { describe, it } from 'node:test';

// Assuming necessary imports for context

// Mock TypeChecker and related TS objects would be needed for actual tests
// For now, we focus on describing the behaviors and test cases.

describe('TypeDeriver Class', () => {
  describe('Initialization and Core Properties', () => {
    it.todo('instantiates with a TypeScript TypeChecker instance', () => {
      // Verify the 'checker' property holds the provided TypeChecker.
    });
    it.todo('initializes the `collector` property as an empty object', () => {
      // Verify 'collector' is an empty object `{}` upon instantiation.
    });
    it.todo(
      'exposes the `deriveSymbol` constant for marking serialized objects',
      () => {
        // Verify `deriveSymbol` is exported and accessible.
      },
    );
    it.todo(
      'exposes the `$types` symbol constant for holding serialized type information',
      () => {
        // Verify `$types` is exported and accessible.
      },
    );
  });

  // --- serializeType Functionality ---

  describe('serializeType: Basic Primitive and Special Types', () => {
    it.todo('serializes `any` type to an empty type list', () => {
      // Input: ts.Type with TypeFlags.Any
      // Output: { [deriveSymbol]: true, optional: false, [$types]: [] }
    });
    it.todo('serializes `unknown` type to an empty type list', () => {
      // Input: ts.Type with TypeFlags.Unknown
      // Output: { [deriveSymbol]: true, optional: false, [$types]: [] }
    });
    it.todo('serializes `string` type', () => {
      // Input: ts.Type with TypeFlags.String
      // Output: { [deriveSymbol]: true, optional: false, [$types]: ['string'] }
    });
    it.todo('serializes `number` type', () => {
      // Input: ts.Type with TypeFlags.Number
      // Output: { [deriveSymbol]: true, optional: false, [$types]: ['number'] }
    });
    it.todo('serializes `boolean` type', () => {
      // Input: ts.Type with TypeFlags.Boolean
      // Output: { [deriveSymbol]: true, optional: false, [$types]: ['boolean'] }
    });
    it.todo('serializes `null` type as optional', () => {
      // Input: ts.Type with TypeFlags.Null
      // Output: { [deriveSymbol]: true, optional: true, [$types]: ['null'] }
    });
    it.todo(
      'serializes `void` type (likely falls back to Any/Unknown or unhandled)',
      () => {
        // Input: ts.Type with TypeFlags.Void (or VoidLike)
        // Determine expected output based on how TS checker presents this type and how the unhandled path works. Likely results in `[$types]: []` or `[$types]: ['void']`.
      },
    );
    it.todo(
      'serializes `never` type (likely falls back to Any/Unknown or unhandled)',
      () => {
        // Input: ts.Type with TypeFlags.Never
        // Determine expected output. Likely results in `[$types]: []` or `[$types]: ['never']`.
      },
    );
    it.todo(
      'serializes `undefined` type implicitly via union/intersection optional flag',
      () => {
        // Note: Undefined itself isn't directly serialized as a standalone type by this logic.
        // Its presence in unions/intersections correctly sets the `optional` flag. Tests are under Union/Intersection sections.
      },
    );
  });

  describe('serializeType: Literal Types', () => {
    it.todo('serializes string literal types with their value', () => {
      // Input: ts.StringLiteralType (e.g., type of "constant")
      // Output: { [deriveSymbol]: true, optional: false, kind: 'literal', value: 'constant', [$types]: ['string'] }
    });
    it.todo('serializes numeric literal types with their value', () => {
      // Input: ts.NumberLiteralType (e.g., type of 123)
      // Output: { [deriveSymbol]: true, optional: false, kind: 'literal', value: 123, [$types]: ['number'] }
    });
    it.todo('serializes boolean literal `true` type', () => {
      // Input: ts.BooleanLiteralType (true) checked via TypeFlags.BooleanLiteral
      // Output: { [deriveSymbol]: true, optional: false, [$types]: ['boolean'] }
      // Note: Current code identifies it's boolean but doesn't store the literal `true` value.
    });
    it.todo('serializes boolean literal `false` type', () => {
      // Input: ts.BooleanLiteralType (false) checked via TypeFlags.BooleanLiteral
      // Output: { [deriveSymbol]: true, optional: false, [$types]: ['boolean'] }
      // Note: Current code identifies it's boolean but doesn't store the literal `false` value.
    });
    it.todo('serializes template literal types as base `string`', () => {
      // Input: ts.Type with TypeFlags.TemplateLiteral (e.g. type of `ID-${number}`)
      // Output: { [deriveSymbol]: true, optional: false, [$types]: ['string'] }
    });
    // Note: BigIntLiteral is not explicitly handled, would fall under unhandled.
  });

  describe('serializeType: Enum Types', () => {
    it.todo(
      'serializes an Enum type (e.g., `enum Color {}`) potentially via unhandled path',
      () => {
        // Input: ts.Type with TypeFlags.Enum (representing the enum itself, e.g., `Color`)
        // Expect it to fall into the unhandled path, likely using checker.typeToString.
        // Output: { [deriveSymbol]: true, optional: false, [$types]: ['Color'] } or similar based on typeToString. Check console warning.
      },
    );
    it.todo(
      'serializes an EnumLiteral type (e.g., `Color.Red`) potentially via unhandled path or base type',
      () => {
        // Input: ts.Type with TypeFlags.EnumLiteral (representing the enum member, e.g., `Color.Red`)
        // Check if TS resolves this to its base type (string/number) or if it falls to unhandled.
        // If number enum: Potentially { [deriveSymbol]: true, optional: false, [$types]: ['number'] }
        // If string enum: Potentially { [deriveSymbol]: true, optional: false, [$types]: ['string'] } or a literal string.
        // If unhandled: { [deriveSymbol]: true, optional: false, [$types]: ['Color.Red'] } or similar. Check console warning.
      },
    );
  });

  describe('serializeType: Union Types (`|`)', () => {
    it.todo(
      'serializes a union of primitive types (e.g., string | number)',
      () => {
        // Input: ts.UnionType with string and number types
        // Output: { [deriveSymbol]: true, kind: 'union', optional: false, [$types]: [serializedString, serializedNumber] }
      },
    );
    it.todo(
      'serializes a union type including `null` (e.g., string | null)',
      () => {
        // Input: ts.UnionType with string and null types
        // Output: { [deriveSymbol]: true, kind: 'union', optional: false, [$types]: [serializedString, serializedNull] }
        // Note: `optional` remains false because `null` is treated as a distinct type here.
      },
    );
    it.todo(
      'serializes a union type including `undefined`, setting optional flag and filtering `undefined`',
      () => {
        // Input: ts.UnionType with string and undefined types
        // Output: { [deriveSymbol]: true, kind: 'union', optional: true, [$types]: [serializedString] } // undefined is filtered out, optional set to true
      },
    );
    it.todo(
      'serializes a union type including both `null` and `undefined`',
      () => {
        // Input: ts.UnionType with string, null, and undefined types
        // Output: { [deriveSymbol]: true, kind: 'union', optional: true, [$types]: [serializedString, serializedNull] } // undefined filtered, optional true
      },
    );
    it.todo('serializes a union of literal types (e.g., "a" | "b" | 1)', () => {
      // Input: ts.UnionType with "a", "b", 1 types
      // Output: { [deriveSymbol]: true, kind: 'union', optional: false, [$types]: [serializedLiteralA, serializedLiteralB, serializedLiteral1] }
    });
    it.todo(
      'serializes a union including complex types (e.g., string | MyInterface)',
      () => {
        // Input: ts.UnionType with string and an interface type
        // Output: { [deriveSymbol]: true, kind: 'union', optional: false, [$types]: [serializedString, serializedInterfaceRef] }
      },
    );
    it.todo('serializes a union containing only `undefined`', () => {
      // Input: ts.UnionType with only undefined type
      // Output: { [deriveSymbol]: true, kind: 'union', optional: true, [$types]: [] }
    });
    it.todo('serializes a union containing only `null`', () => {
      // Input: ts.UnionType with only null type
      // Output: { [deriveSymbol]: true, kind: 'union', optional: false, [$types]: [serializedNull] }
    });
  });

  describe('serializeType: Intersection Types (`&`)', () => {
    it.todo(
      'serializes an intersection of object/interface types (e.g., A & B)',
      () => {
        // Input: ts.IntersectionType with two interface types A and B
        // Output: { [deriveSymbol]: true, kind: 'intersection', optional: false, [$types]: [serializedInterfaceA, serializedInterfaceB] }
      },
    );
    it.todo(
      'serializes an intersection type including `undefined`, setting optional flag and filtering `undefined`',
      () => {
        // Input: ts.IntersectionType with an interface type A and undefined
        // Output: { [deriveSymbol]: true, kind: 'intersection', optional: true, [$types]: [serializedInterfaceA] }
      },
    );
    it.todo('serializes an intersection containing only `undefined`', () => {
      // Input: ts.IntersectionType with only undefined type
      // Output: { [deriveSymbol]: true, kind: 'intersection', optional: true, [$types]: [] }
    });
    // Note: Intersections of primitives often resolve to `never`. The serialization of `never` itself is tested separately.
  });

  describe('serializeType: Array and Tuple Types', () => {
    it.todo('serializes a simple array type (e.g., string[])', () => {
      // Input: ts.TypeReference to Array<string>
      // Mock checker.isArrayLikeType -> true, checker.getTypeArguments -> [stringType]
      // Output: { [deriveSymbol]: true, kind: 'array', optional: false, [$types]: [serializedString] }
    });
    it.todo('serializes readonly array types (e.g., readonly number[])', () => {
      // Input: ts.TypeReference to ReadonlyArray<number>
      // Mock checker.isArrayLikeType -> true, checker.getTypeArguments -> [numberType]
      // Output: { [deriveSymbol]: true, kind: 'array', optional: false, [$types]: [serializedNumber] }
    });
    it.todo(
      'serializes an array type with object elements (e.g., MyInterface[])',
      () => {
        // Input: ts.TypeReference to Array<MyInterface>
        // Mock checker.getTypeArguments -> [interfaceType], interfaceType.symbol.valueDeclaration -> InterfaceDeclaration Node
        // Output: { [deriveSymbol]: true, kind: 'array', optional: false, [$types]: [serializedInterfaceRef] } // Relies on serializeNode call
      },
    );
    it.todo(
      'serializes an array type with union elements (e.g., (string | number)[])',
      () => {
        // Input: ts.TypeReference to Array<string | number>
        // Mock checker.getTypeArguments -> [unionType]
        // Output: { [deriveSymbol]: true, kind: 'array', optional: false, [$types]: [serializedUnionStringNumber] }
      },
    );
    it.todo('serializes an array type where element type has no symbol', () => {
      // Input: ts.TypeReference to Array<{inline: boolean}>
      // Mock checker.getTypeArguments -> [inlineObjectType], inlineObjectType.getSymbol() -> undefined
      // Output: { [deriveSymbol]: true, kind: 'array', optional: false, [$types]: [serializedInlineObject] } // Relies on serializeType(inlineObjectType)
    });
    it.todo(
      'serializes an array type where element symbol has no value declaration but has declarations',
      () => {
        // Input: ts.TypeReference to Array<SomeType>
        // Mock checker.getTypeArguments -> [someType], someType.symbol.valueDeclaration -> undefined, someType.symbol.declarations -> [TypeAliasDeclaration Node?]
        // Expect serializeNode to be called with declarations[0]. Verify output based on that node type.
      },
    );
    it.todo(
      'serializes an array type with a mapped type element (e.g., MappedType[])',
      () => {
        // Input: ts.TypeReference to Array<MappedType>
        // Mock checker.getTypeArguments -> [mappedType], mappedType symbol has declarations[0] as MappedTypeNode
        // Mock checker.getPropertiesOfType for mappedType
        // Output: { kind: 'array', optional: false, [deriveSymbol]: true, [$types]: [resolvedMappedObject] }
      },
    );
    it.todo(
      'handles array-like types with missing type arguments gracefully (e.g., Array)',
      () => {
        // Input: ts.TypeReference to Array (no <T>)
        // Mock checker.getTypeArguments -> undefined or []
        // Output: { [deriveSymbol]: true, optional: false, kind: 'array', [$types]: ['any'] } // Check console warning
      },
    );
    it.todo(
      'serializes tuple types (e.g., [string, number]) potentially as array of union',
      () => {
        // Input: ts.TupleTypeReference for [string, number]
        // Mock checker.isArrayLikeType -> true. Check what checker.getTypeArguments returns (likely the tuple element types).
        // Current code likely serializes as Array<string | number>.
        // Expected Output (based on current code): { [deriveSymbol]: true, kind: 'array', optional: false, [$types]: [serializedUnionStringNumber] } or similar union.
        // Note: A more precise tuple serialization would require specific handling of ts.TupleTypeReference.
      },
    );
  });

  describe('serializeType: Record/Index Types', () => {
    it.todo(
      'serializes a string index signature type (Record<string, number>)',
      () => {
        // Input: ts.Type where type.getStringIndexType() returns numberType
        // Output: { [deriveSymbol]: true, kind: 'record', optional: false, [$types]: [serializedNumber] }
      },
    );
    it.todo(
      'serializes a string index signature type with complex value (Record<string, MyInterface>)',
      () => {
        // Input: ts.Type where type.getStringIndexType() returns interfaceType
        // Output: { [deriveSymbol]: true, kind: 'record', optional: false, [$types]: [serializedInterfaceRef] }
      },
    );
    it.todo(
      'serializes a type with only a number index signature ([key: number]: boolean)',
      () => {
        // Input: ts.Type where type.getStringIndexType() is undefined, but type.getNumberIndexType() exists.
        // Expect this to *not* take the `getStringIndexType` path.
        // It should fall into the `TypeFlags.Object` path.
        // Mock checker.getPropertiesOfType (might be empty or special symbol).
        // Mock type.symbol.declarations to include the IndexSignature node.
        // Expected Output: Likely falls back to generic object or potentially unhandled `{ [deriveSymbol]: true, optional: false, [$types]: ['<some object representation>'] }`. Needs verification against actual TS behavior.
      },
    );
  });

  describe('serializeType: Object Types (Interfaces, Classes, Inline, Mapped)', () => {
    it.todo('serializes an inline object type literal (passed as type)', () => {
      // Input: ts.Type representing `{ a: string; b?: number }` (TypeFlags.Object)
      // Mock checker.getPropertiesOfType -> [symbolA, symbolB]
      // Mock checker.getTypeOfSymbol for 'a' (string) and 'b' (number | undefined)
      // Output: { [deriveSymbol]: true, kind: 'object', optional: false, [$types]: [{ a: serializedString, b: serializedUnionNumberUndefined }] }
    });
    it.todo(
      'serializes a mapped type directly (e.g., type M = { [K in keyof T]: T[K] })',
      () => {
        // Input: ts.Type representing a mapped type (TypeFlags.Object, potentially others)
        // Mock checker.getPropertiesOfType to return the mapped properties.
        // Mock checker.getTypeOfSymbol for each mapped property.
        // Output: { [deriveSymbol]: true, kind: 'object', optional: false, [$types]: [{ /* serialized mapped properties */ }] }
      },
    );
    it.todo(
      'serializes an object type using literal property assignments from declarations',
      () => {
        // Input: ts.Type representing an object like `const x = { val: 123 }`
        // Mock checker.getPropertiesOfType -> [symbolVal]
        // Mock symbolVal.getDeclarations() -> [PropertyAssignment node with literal 123]
        // Mock checker.getTypeAtLocation for the literal initializer -> numberLiteralType(123)
        // Output: { [deriveSymbol]: true, kind: 'object', optional: false, [$types]: [{ val: serializedLiteral123 }] }
      },
    );
    it.todo(
      'serializes an object type with mixed declared types (PropertySignature) and literal assignments (PropertyAssignment)',
      () => {
        // Input: ts.Type representing `{ prop: string; literal: "hello" }` where `prop` comes from signature and `literal` from assignment.
        // Ensure both `isPropertyAssignment` and `isPropertySignature` paths within the loop are tested.
        // Output: { [deriveSymbol]: true, kind: 'object', optional: false, [$types]: [{ prop: serializedString, literal: serializedLiteralHello }] }
      },
    );
    it.todo(
      'serializes an empty object type `{}` potentially falling back to name or generic',
      () => {
        // Input: ts.Type representing `{}` (TypeFlags.Object)
        // Mock checker.getPropertiesOfType -> []
        // Mock type.symbol.valueDeclaration / declarations -> undefined
        // Mock type.symbol.getName() -> 'Object' or similar
        // Expected Output: Depends on fallback logic. Potentially `{ [deriveSymbol]: true, optional: false, [$types]: ['Object'] }` or a generic object representation if name is unhelpful.
      },
    );
    it.todo(
      'handles object types matching default overrides (e.g., DateConstructor -> string)',
      () => {
        // Input: ts.Type whose symbol name is 'DateConstructor' (present in `defaults`)
        // Output: { [deriveSymbol]: true, optional: false, [$types]: ['string'] } // Value from `defaults` map
      },
    );
    it.todo(
      'handles known object types NOT in defaults (e.g., RegExp) by attempting standard object serialization',
      () => {
        // Input: ts.Type for RegExp (not in `defaults`)
        // Mock checker.getPropertiesOfType (likely empty or methods)
        // Mock symbol.valueDeclaration / declarations (likely points to lib.d.ts)
        // Expect standard object serialization attempt, possibly resulting in an empty object or reference if declaration is found.
        // Output: { [deriveSymbol]: true, kind: 'object', optional: false, [$types]: [{ /* properties or empty */ }] } or a reference via serializeNode.
      },
    );
    it.todo(
      'serializes an interface type by deferring to serializeNode for reference/collection',
      () => {
        // Input: ts.InterfaceType (isInterfaceType returns true)
        // Mock type.symbol.valueDeclaration or declarations[0] -> InterfaceDeclaration node
        // Verify serializeNode is called with the declaration node.
        // Output: { [deriveSymbol]: true, optional: false, [$types]: [`#/components/schemas/MyInterface`] }
      },
    );
    it.todo(
      'serializes a class type by deferring to serializeNode for reference/collection',
      () => {
        // Input: ts.Type representing a class (isClass returns true)
        // Mock type.symbol.valueDeclaration -> ClassDeclaration node
        // Verify serializeNode is called with the declaration node.
        // Output: { [deriveSymbol]: true, optional: false, [$types]: [`#/components/schemas/MyClass`], $ref: `#/components/schemas/MyClass` }
      },
    );
    it.todo(
      'serializes an interface type using its name when its declaration cannot be found',
      () => {
        // Input: ts.InterfaceType where type.symbol has no valueDeclaration or declarations[0]
        // Mock type.symbol.getName() -> 'MyInterface'
        // Output: { [deriveSymbol]: true, optional: false, [$types]: ['MyInterface'] }
      },
    );
    it.todo(
      'serializes a class type using its name when its declaration cannot be found',
      () => {
        // Input: ts.Type for a class where type.symbol has no valueDeclaration
        // Mock type.symbol.getName() -> 'MyClass'
        // Output: { [deriveSymbol]: true, optional: false, [$types]: ['MyClass'] }
      },
    );
  });

  describe('serializeType: Unhandled Types', () => {
    it.todo(
      'handles an unhandled type flag by using checker.typeToString and warns',
      () => {
        // Input: A ts.Type with flags not explicitly handled (e.g., potentially Enum, Index, IndexedAccess if not resolved)
        // Mock checker.typeToString -> '<specific unhandled representation>'
        // Output: { [deriveSymbol]: true, optional: false, [$types]: ['<specific unhandled representation>'] } // Check console warning
      },
    );
    // Note: Complex types like ConditionalType, IndexedAccessType are expected to be resolved by the checker *before* this function sees them.
    // We serialize the *result* of the resolution, not the conditional/indexed access type itself.
  });

  // --- serializeNode Functionality ---

  describe('serializeNode: Object Literal Expressions (`{ ... }`)', () => {
    it.todo(
      'serializes an object literal node with various primitive property types',
      () => {
        // Input: ts.ObjectLiteralExpression node `{ a: 1, b: "s", c: true, d: null, e: undefined }`
        // Mock checker.getTypeAtLocation for the node itself
        // Mock checker.getTypeOfSymbol for properties 'a', 'b', 'c', 'd', 'e'
        // Mock checker.getTypeAtLocation for literal initializers (1, "s", true, null, undefined)
        // Output: { a: serializedLiteral1, b: serializedLiteralS, c: serializedLiteralTrue, d: serializedNull, e: serializedUndefined } // Note: undefined serialization depends on serializeType
      },
    );
    it.todo(
      'serializes an object literal node with nested object/array literals',
      () => {
        // Input: ts.ObjectLiteralExpression node `{ data: { values: [1, 2] } }`
        // Ensure recursive serialization via serializeType/serializeNode works.
        // Output: { data: { values: serializedArrayLiteral12 } }
      },
    );
    it.todo('serializes an empty object literal node `{}`', () => {
      // Input: ts.ObjectLiteralExpression node `{}`
      // Mock checker.getTypeAtLocation -> empty object type
      // Output: {}
    });
  });

  describe('serializeNode: Property Access/Signature/Declaration', () => {
    it.todo(
      'serializes a PropertyAccessExpression node (e.g., `obj.prop`) by resolving its type',
      () => {
        // Input: ts.PropertyAccessExpression node `obj.prop`
        // Mock checker.getSymbolAtLocation for `prop` -> symbolProp
        // Mock checker.getTypeOfSymbol(symbolProp) -> typeProp
        // Verify serializeType is called with typeProp.
        // Output: Result of serializeType(typeProp)
      },
    );
    it.todo(
      'serializes a PropertySignature node (e.g., `prop: string;`) by resolving its type',
      () => {
        // Input: ts.PropertySignature node `prop: string;` (within an InterfaceDeclaration or TypeLiteral)
        // Mock checker.getSymbolAtLocation for `prop` -> symbolProp
        // Mock checker.getTypeOfSymbol(symbolProp) -> stringType
        // Verify serializeType is called with stringType.
        // Output: Result of serializeType(stringType)
      },
    );
    it.todo(
      'serializes a PropertyDeclaration node (e.g., `prop: number;`) by resolving its type',
      () => {
        // Input: ts.PropertyDeclaration node `prop: number;` (within a ClassDeclaration)
        // Mock checker.getSymbolAtLocation for `prop` -> symbolProp
        // Mock checker.getTypeOfSymbol(symbolProp) -> numberType
        // Verify serializeType is called with numberType.
        // Output: Result of serializeType(numberType)
      },
    );
    it.todo(
      'handles property nodes where symbol cannot be found for the property name and warns',
      () => {
        // Input: A PropertySignature/Declaration/Access node where checker.getSymbolAtLocation(node.name) returns undefined
        // Output: null // Check console warning
      },
    );
  });

  describe('serializeNode: Interface Declarations (`interface ...`) and Collector Interaction', () => {
    it.todo(
      'serializes a new interface declaration, adding its structure to the collector',
      () => {
        // Input: ts.InterfaceDeclaration node `interface MyInterface { id: number; name?: string; }`
        // Ensure collector['MyInterface'] is initially empty/undefined.
        // Mock members `id` and `name` and their serialization via serializeNode(PropertySignature).
        // Output: { [deriveSymbol]: true, optional: false, [$types]: [`#/components/schemas/MyInterface`] }
        // Verify collector['MyInterface'] now contains { id: serializedNumber, name: serializedUnionStringUndefined }
      },
    );
    it.todo(
      'returns only a reference for an already serialized interface declaration (present in collector)',
      () => {
        // Input: ts.InterfaceDeclaration node `interface MyInterface { ... }`
        // Pre-populate collector['MyInterface'] with a placeholder or previous result.
        // Output: { [deriveSymbol]: true, optional: false, [$types]: [`#/components/schemas/MyInterface`] }
        // Verify collector['MyInterface'] was not overwritten if already fully populated.
      },
    );
    it.todo(
      'handles interface declarations matching default overrides without adding to collector',
      () => {
        // Input: ts.InterfaceDeclaration node `interface Readable { ... }` (name is in `defaults`)
        // Output: { [deriveSymbol]: true, optional: false, [$types]: ['any'] } // Value from `defaults` map
        // Verify collector['Readable'] remains undefined or unchanged.
      },
    );
    it.todo(
      'throws an error for an interface declaration without a name',
      () => {
        // Input: An InterfaceDeclaration node where node.name is undefined.
        // Expect the function to throw 'Interface has no name'.
      },
    );
    it.todo(
      'handles interfaces with no members correctly (adds empty object to collector)',
      () => {
        // Input: ts.InterfaceDeclaration node `interface Empty {}`
        // Output: { [deriveSymbol]: true, optional: false, [$types]: [`#/components/schemas/Empty`] }
        // Verify collector['Empty'] is `{}`.
      },
    );
    it.todo(
      'handles interfaces extending other interfaces (serialization includes only own properties)',
      () => {
        // Input: `interface B extends A { propB: string; }` (where A is `interface A { propA: number }`)
        // Serialize B.
        // Output: Reference `#/components/schemas/B`
        // Verify collector['B'] contains only `{ propB: serializedString }`. (Inherited props are resolved by tools consuming the schema, not duplicated here).
        // Note: Actual inheritance representation might need adjustment based on target schema format (e.g., OpenAPI `allOf`). This test verifies the *collector* content based on current code.
      },
    );
  });

  describe('serializeNode: Class Declarations (`class ...`) and Collector Interaction', () => {
    it.todo(
      'serializes a new class declaration, adding its property structure to the collector',
      () => {
        // Input: ts.ClassDeclaration node `class MyClass { id: number; private secret: string; constructor() {} }`
        // Ensure collector['MyClass'] is initially empty/undefined.
        // Mock members `id` and `secret` and their serialization via serializeNode(PropertyDeclaration). Ignore constructor/methods.
        // Output: { [deriveSymbol]: true, optional: false, [$types]: [`#/components/schemas/MyClass`], $ref: `#/components/schemas/MyClass` }
        // Verify collector['MyClass'] now contains { id: serializedNumber, secret: serializedString } (Includes private members)
      },
    );
    it.todo(
      'returns only a reference for an already serialized class declaration (present in collector)',
      () => {
        // Input: ts.ClassDeclaration node `class MyClass { ... }`
        // Pre-populate collector['MyClass'] with a placeholder or previous result.
        // Output: { [deriveSymbol]: true, optional: false, [$types]: [`#/components/schemas/MyClass`], $ref: `#/components/schemas/MyClass` }
        // Verify collector['MyClass'] was not overwritten if already fully populated.
      },
    );
    it.todo(
      'handles class declarations matching default overrides without adding to collector',
      () => {
        // Input: ts.ClassDeclaration node `class Uint8Array { ... }` (name is in `defaults`)
        // Output: { [deriveSymbol]: true, optional: false, [$types]: ['any'] } // Value from `defaults` map
        // Verify collector['Uint8Array'] remains undefined or unchanged.
      },
    );
    it.todo(
      'throws an error for a class declaration without a name (e.g., anonymous default export)',
      () => {
        // Input: A ClassDeclaration node where node.name is undefined.
        // Expect the function to throw 'Class has no name'.
      },
    );
    it.todo(
      'handles classes with no property declarations (only methods/constructor) correctly (adds empty object to collector)',
      () => {
        // Input: ts.ClassDeclaration node `class Service { constructor() {} process() {} }`
        // Output: { [deriveSymbol]: true, optional: false, [$types]: [`#/components/schemas/Service`], $ref: `#/components/schemas/Service` }
        // Verify collector['Service'] is `{}`.
      },
    );
    it.todo(
      'handles classes implementing interfaces (serialization includes only own properties)',
      () => {
        // Input: `class B implements A { propB: string; }` (where A is `interface A { propA: number }`)
        // Serialize B.
        // Output: Reference `#/components/schemas/B`
        // Verify collector['B'] contains only `{ propB: serializedString }`.
      },
    );
    it.todo(
      'handles classes extending other classes (serialization includes only own properties)',
      () => {
        // Input: `class D extends C { propD: string; }` (where C is `class C { propC: number }`)
        // Serialize D.
        // Output: Reference `#/components/schemas/D`
        // Verify collector['D'] contains only `{ propD: serializedString }`.
      },
    );
  });

  describe('serializeNode: Other Node Types', () => {
    it.todo(
      'serializes a VariableDeclaration node with an explicit type annotation',
      () => {
        // Input: ts.VariableDeclaration node `const user: IUser;`
        // Mock node.type to be a TypeReference node pointing to IUser
        // Mock checker.getTypeFromTypeNode -> interfaceType IUser
        // Verify serializeType is called with interfaceType IUser.
        // Output: Result of serializeType(interfaceType IUser) -> likely interface reference
      },
    );
    it.todo(
      'handles VariableDeclaration node without a type annotation and warns',
      () => {
        // Input: ts.VariableDeclaration node `const count = 5;` (node.type is undefined)
        // Output: 'any' // Check console warning
      },
    );
    it.todo(
      'handles VariableDeclaration node where symbol cannot be found for the variable name and warns',
      () => {
        // Input: ts.VariableDeclaration node where checker.getSymbolAtLocation(node.name) returns undefined
        // Output: null // Check console warning
      },
    );
    it.todo(
      'serializes an Identifier node by resolving its type at that location',
      () => {
        // Input: ts.Identifier node `myVar` (where myVar is declared as string)
        // Mock checker.getSymbolAtLocation for the identifier -> symbolMyVar
        // Mock checker.getTypeAtLocation for the identifier node -> stringType
        // Verify serializeType is called with stringType.
        // Output: Result of serializeType(stringType)
      },
    );
    it.todo(
      'handles Identifier node where symbol cannot be found and warns',
      () => {
        // Input: ts.Identifier node where checker.getSymbolAtLocation returns undefined
        // Output: null // Check console warning
      },
    );
    it.todo(
      'serializes an AwaitExpression node by resolving the awaited type',
      () => {
        // Input: ts.AwaitExpression node `await getUser()` where getUser returns Promise<User>
        // Mock checker.getTypeAtLocation(node) -> User type (checker resolves the Promise)
        // Verify serializeType is called with the User type.
        // Output: Result of serializeType(User type)
      },
    );
    it.todo(
      'serializes a CallExpression node by resolving its return type',
      () => {
        // Input: ts.CallExpression node `calculateTotal()` where calculateTotal returns number
        // Mock checker.getTypeAtLocation(node) -> numberType
        // Verify serializeType is called with numberType.
        // Output: Result of serializeType(numberType)
      },
    );
    it.todo(
      'serializes an AsExpression node by resolving the asserted type',
      () => {
        // Input: ts.AsExpression node `data as Product`
        // Mock checker.getTypeAtLocation(node) -> Product type (the asserted type)
        // Verify serializeType is called with the Product type.
        // Output: Result of serializeType(Product type)
      },
    );
    it.todo(
      'serializes a TypeLiteralNode (`{ ... }` used as a type) by resolving its properties',
      () => {
        // Input: ts.TypeLiteralNode node `{ id: number; value: string }`
        // Mock checker.getTypeAtLocation(node) -> objectType
        // Mock checker.getPropertiesOfType(objectType) -> [symbolId, symbolValue]
        // Mock checker.getTypeOfSymbol for each property.
        // Output: { [deriveSymbol]: true, optional: false, [$types]: [{ id: serializedNumber, value: serializedString }] }
      },
    );
    it.todo('serializes NullKeyword node', () => {
      // Input: Node with kind ts.SyntaxKind.NullKeyword
      // Output: { [deriveSymbol]: true, optional: true, [$types]: ['null'] }
    });
    it.todo('serializes BooleanKeyword node', () => {
      // Input: Node with kind ts.SyntaxKind.BooleanKeyword
      // Output: { [deriveSymbol]: true, optional: false, [$types]: ['boolean'] }
    });
    it.todo('serializes TrueKeyword node as boolean literal', () => {
      // Input: Node with kind ts.SyntaxKind.TrueKeyword
      // Output: { [deriveSymbol]: true, optional: false, kind: 'literal', value: true, [$types]: ['boolean'] }
    });
    it.todo('serializes FalseKeyword node as boolean literal', () => {
      // Input: Node with kind ts.SyntaxKind.FalseKeyword
      // Output: { [deriveSymbol]: true, optional: false, kind: 'literal', value: false, [$types]: ['boolean'] }
    });
    it.todo(
      'serializes an ArrayLiteralExpression node by resolving its inferred type',
      () => {
        // Input: ts.ArrayLiteralExpression node `[1, "a", null]`
        // Mock checker.getTypeAtLocation(node) -> inferred array type (e.g., (number | string | null)[])
        // Verify serializeType is called with the inferred type.
        // Output: Result of serializeType(inferred array type) -> likely array of union
      },
    );
    it.todo(
      'handles an unhandled node kind by returning `any` and warns',
      () => {
        // Input: A node with a kind not explicitly handled (e.g., ts.SyntaxKind.IfStatement)
        // Output: { [deriveSymbol]: true, optional: false, [$types]: ['any'] } // Check console warning
      },
    );
  });

  describe('Helper Function: isInterfaceType', () => {
    it.todo('returns true for a type whose symbol is an Interface', () => {
      // Input: ts.Type where type.isClassOrInterface() is true and type.symbol.flags includes ts.SymbolFlags.Interface
      // Output: true
    });
    it.todo('returns false for a type whose symbol is a Class', () => {
      // Input: ts.Type where type.isClassOrInterface() is true and type.symbol.flags includes ts.SymbolFlags.Class but not Interface
      // Output: false
    });
    it.todo('returns false for a type that is not a class or interface', () => {
      // Input: ts.Type for string, number, etc. where type.isClassOrInterface() is false
      // Output: false
    });
    it.todo('returns false if the type has no symbol', () => {
      // Input: ts.Type where type.symbol is undefined (e.g., some primitive types)
      // Output: false (as it won't have the Interface flag)
    });
  });
});
