import { merge } from 'lodash-es';
import assert from 'node:assert';
import type {
  OpenAPIObject,
  ReferenceObject,
  SchemaObject,
} from 'openapi3-ts/oas31';
import { camelcase, snakecase } from 'stringcase';

import {
  cleanRef,
  followRef,
  isEmpty,
  isRef,
  notRef,
  parseRef,
  pascalcase,
} from '@sdk-it/core';

const reservedWords = new Set([
  'abstract',
  'as',
  'assert',
  'async',
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'default',
  'deferred',
  'do',
  'dynamic',
  'else',
  'enum',
  'export',
  'extends',
  'extension',
  'external',
  'factory',
  'final',
  'finally',
  'for',
  'Function',
  'get',
  'set',
  'hide',
  'if',
  'implements',
  'import',
  'in',
  'interface',
  'is',
  'library',
  'mixin',
  'new',
  'null',
  'on',
  'operator',
  'part',
  'required',
  'rethrow',
  'return',
  'hide',
  'show',
]);

const formatName = (it: any): string => {
  if (reservedWords.has(it)) {
    return `$${it}`;
  }
  const startsWithDigitPattern = /^-?\d/;
  // 1. Handle numbers
  if (typeof it === 'number') {
    if (Math.sign(it) === -1) {
      return `$_${Math.abs(it)}`;
    }
    return `$${it}`;
  }

  // 2. Handle the specific string 'default'
  if (it === 'default') {
    return '$default';
  }

  // 3. Handle other strings
  if (typeof it === 'string') {
    // 3a. Check if the string starts with a digit FIRST
    if (startsWithDigitPattern.test(it)) {
      if (typeof it === 'number') {
        if (Math.sign(it) === -1) {
          return `$_${Math.abs(it)}`;
        }
        return `$${it}`;
      }
    }

    // 3b. If not starting with a digit, handle brackets and snake_case
    let nameToFormat = it;

    // Remove a single leading '[' if present
    if (nameToFormat.startsWith('[')) {
      nameToFormat = nameToFormat.slice(1);
    }

    // Remove a single trailing ']' if present
    if (nameToFormat.endsWith(']')) {
      nameToFormat = nameToFormat.slice(0, -1);
    }

    return nameToFormat;
  }

  // 4. Fallback for any other types (e.g., null, undefined, objects)
  // Convert to string first, then apply snakecase
  return String(it);
};

type Context = Record<string, any>;
type Serialized = {
  nullable?: boolean;
  encode?: string;
  use: string;
  toJson: string;
  matches?: string;
  fromJson: string;
  type?: string;
  content: string;
  simple?: boolean;
};
type Emit = (name: string, content: string) => void;
/**
 * Convert an OpenAPI (JSON Schema style) object into Dart classes
 */
export class DartSerializer {
  #spec: OpenAPIObject;
  #emit: Emit;

  constructor(spec: OpenAPIObject, emit: Emit) {
    this.#spec = spec;
    this.#emit = emit;
  }

  #getRefUsage(schemaName: string, list: string[] = []): string[] {
    this.#spec.components ??= {};
    this.#spec.components.schemas ??= {};
    this.#spec.components.responses ??= {};

    const checkSchema = (schema: SchemaObject | ReferenceObject): boolean => {
      if (isRef(schema)) {
        const { model } = parseRef(schema.$ref);
        return model === schemaName;
      }
      if (schema.oneOf && Array.isArray(schema.oneOf)) {
        return (schema.oneOf as Array<SchemaObject | ReferenceObject>).some(
          (subSchema) => checkSchema(subSchema),
        );
      }
      if (
        schema.type === 'array' &&
        schema.items &&
        notRef(schema.items) &&
        schema.items.oneOf
      ) {
        return checkSchema(schema.items);
      }
      return false;
    };

    for (const [key, value] of Object.entries(this.#spec.components.schemas)) {
      if (checkSchema(value)) {
        list.push(key);
      }
    }

    return list;
  }

  #object(
    className: string,
    schema: SchemaObject,
    context: Context,
  ): Serialized {
    if (schema.additionalProperties) {
      this.#emit(className, `typedef ${className} = Map<String, dynamic>;`);
      return {
        content: '',
        use: 'Map<String, dynamic>',
        encode: 'input',
        toJson: `this.${camelcase(context.name)}`,
        fromJson: `json['${camelcase(context.name)}']`,
        matches: `json['${camelcase(context.name)}'] is Map<String, dynamic>`,
      };
    }
    if (isEmpty(schema.properties)) {
      if (context.noEmit !== true) {
        this.#emit(
          className,
          `class ${className} {
  const ${className}(); // Add const constructor

  factory ${className}.fromJson(Map<String, dynamic> json) {
    return const ${className}();
  }

  Map<String, dynamic> toJson() => {};

  /// Determines if a given map can be parsed into an instance of this class.
  /// Returns true for any map since this class has no properties.
  static bool matches(Map<String, dynamic> json) {
    return true; // Any map is fine for an empty object
  }
}`,
        );
      }
      return {
        content: '',
        encode: 'input.toJson()',
        use: className,
        toJson: `${this.#safe(context.name as string, context.required)}`,
        fromJson: `${className}.fromJson(json['${context.name}'])`,
        matches: `${className}.matches(json['${context.name}'])`,
      };
    }

    const props: string[] = [];
    const toJsonProperties: string[] = [];
    const constructorParams: string[] = [];
    const fromJsonParams: string[] = [];
    const matches: string[] = [];

    for (const [key, propSchema] of Object.entries(schema.properties)) {
      const propName = key.replace('[]', '');
      const safePropName = camelcase(formatName(propName));
      const required = (schema.required ?? []).includes(key);
      const typeStr = this.handle(className, propSchema, required, {
        name: propName,
        safeName: safePropName,
        required,
        propName: [className, propName].filter(Boolean).join('_'),
      });
      const nullable = typeStr.nullable || !required;
      const nullableSuffix = nullable ? '?' : '';
      props.push(`final ${typeStr.use}${nullableSuffix} ${safePropName};`);
      fromJsonParams.push(`${safePropName}: ${typeStr.fromJson}`);
      toJsonProperties.push(`'${propName}': ${typeStr.toJson}`);
      constructorParams.push(
        `${required ? 'required ' : ''}this.${safePropName},`,
      );
      if (required) {
        matches.push(`(
  json.containsKey('${camelcase(propName)}')
  ? ${nullable ? `json['${propName}'] == null` : `json['${propName}'] != null`} ${typeStr.matches ? `&& ${typeStr.matches}` : ''}
  : false)`);
      } else {
        matches.push(`(
  json.containsKey('${camelcase(propName)}')
  ? ${nullable ? `json['${propName}'] == null` : `json['${propName}'] != null`} ${typeStr.matches ? `|| ${typeStr.matches}` : ''}
  : true)`);
      }
    }

    const { mixins, withMixins } = this.#mixinise(className, context);
    const content = `class ${className} ${withMixins} {
      ${props.join('\n')}
      ${!mixins.length ? 'const' : ''} ${className}({
      ${constructorParams.join('\n')}})${mixins.length > 1 ? '' : `:super()`};
       factory ${className}.fromJson(Map<String, dynamic> json) {
return ${className}(\n${fromJsonParams.join(',\n')});
      }
      Map<String, dynamic> toJson() => {
${toJsonProperties.join(',\n')}
      };
      static bool matches(Map<String, dynamic> json) {
return ${matches.join(' && ')};
      }
    }`;
    if (context.noEmit !== true) {
      this.#emit(className, content);
    }
    const nullable = !context.required || context.nullable === true;
    return {
      use: className,
      content,
      encode: 'input.toJson()',
      toJson: `${this.#safe(context.name, context.required)}`,
      fromJson: context.name
        ? `${context.forJson || className}.fromJson(json['${context.name}'])`
        : `${context.forJson || className}.fromJson(json)`,
      matches: `${className}.matches(json['${context.name}'])`,
    };
  }

  #safe(accces: string, required: boolean) {
    return required
      ? `this.${camelcase(accces)}.toJson()`
      : `this.${camelcase(accces)} != null ? this.${camelcase(accces)}!.toJson() : null`;
  }

  #array(
    className: string,
    schema: SchemaObject,
    required = false,
    context: Context,
  ): Serialized {
    if (!schema.items) {
      return {
        content: '',
        use: 'List<dynamic>',
        toJson: '',
        fromJson: `List<dynamic>.from(${context.name ? `json['${context.name}']` : `json`})})`,
        matches: '',
      };
    }
    const itemsType = this.handle(className, schema.items, true, context);
    const fromJson = required
      ? context.name
        ? `(json['${context.name}'] as List<${itemsType.simple ? itemsType.use : 'dynamic'}>)
            .map((it) => ${itemsType.simple ? 'it' : `${itemsType.use}.fromJson(it)`})
            .toList()`
        : `(json as List<${itemsType.simple ? itemsType.use : 'dynamic'}>)
            .map((it) => ${itemsType.simple ? 'it' : `${itemsType.use}.fromJson(it)`})
            .toList()`
      : context.name
        ? `json['${context.name}'] != null
            ? (json['${context.name}'] as List<${itemsType.simple ? itemsType.use : 'dynamic'}>)
                .map((it) => ${itemsType.simple ? 'it' : `${itemsType.use}.fromJson(it)`})
                .toList()
            : null`
        : `json != null
            ? (json as List<${itemsType.simple ? itemsType.use : 'dynamic'}>)
                .map((it) => ${itemsType.simple ? 'it' : `${itemsType.use}.fromJson(it)`})
                .toList()
            : null`;

    return {
      encode: `input.map((it) => ${itemsType.simple ? 'it' : `it.toJson()`}).toList()`,
      content: '',
      use: `List<${itemsType.use}>`,
      fromJson,
      toJson: `${context.required ? `${camelcase(context.safeName || context.name)}${itemsType.simple ? '' : '.map((it) => it.toJson()).toList()'}` : `${camelcase(context.safeName || context.name)} != null ? ${camelcase(context.safeName || context.name)}${itemsType.simple ? '' : '!.map((it) => it.toJson()).toList()'} : null`}`,
      matches: `json['${camelcase(context.name)}'].every((it) => ${itemsType.matches})`,
    };
  }

  /**
   * Convert a basic type to Dart
   */
  #primitive(
    className: string,
    type: string,
    schema: SchemaObject,
    context: Record<string, unknown>,
    required = false,
  ): Serialized {
    const safeName = (context.safeName || context.name) as string;
    switch (type) {
      case 'string':
        return this.#string(schema, context);
      case 'number':
      case 'integer':
        return this.number(schema, context);
      case 'boolean':
        return {
          content: '',
          use: 'bool',
          toJson: safeName,
          fromJson: `json['${context.name}']`,
          matches: `json['${context.name}'] is bool`,
        };
      case 'object':
        return this.#object(className, schema, context);
      case 'array':
        return this.#array(className, schema, required, context);
      case 'null':
        return {
          content: '',
          use: 'Null',
          toJson: safeName,
          fromJson: `json['${context.name}']`,
        };
      default:
        // Unknown type -> fallback
        return {
          content: '',
          use: 'dynamic',
          nullable: false,
          toJson: safeName,
          fromJson: `json['${context.name}']`,
        };
    }
  }

  #ref(
    className: string,
    $ref: string,
    required: boolean,
    context: Context,
  ): Serialized {
    const schemaName = cleanRef($ref).split('/').pop()!;

    const serialized = this.handle(
      schemaName,
      followRef<SchemaObject>(this.#spec, $ref),
      required,
      {
        ...context,
        propName: schemaName,
        noEmit: !!context.alias || !!className || !context.forceEmit,
      },
    );
    return serialized;
  }

  // fixme: this method should no longer be needed because the logic in it is being preprocessed before emitting begins
  #allOf(
    className: string,
    schemas: (SchemaObject | ReferenceObject)[],
    context: Context,
  ): Serialized {
    const name = pascalcase(context.propName || className); // className in case is top level

    const refs = schemas.filter(isRef);
    const nonRefs = schemas.filter(notRef);
    if (nonRefs.some((it) => it.type && it.type !== 'object')) {
      assert(false, `allOf ${name} must be an object`);
    }
    const objectSchema = merge(
      {},
      ...nonRefs,
      ...refs.map((ref) => followRef(this.#spec, ref.$ref)),
    );
    delete objectSchema.allOf;
    return this.handle(name, objectSchema, true, context);
  }

  #anyOf(
    className: string,
    schemas: (SchemaObject | ReferenceObject)[],
    context: Record<string, unknown>,
  ): Serialized {
    // fixme: handle
    if (schemas.length === 0) {
      return {
        content: '',
        nullable: false,
        use: 'dynamic',
        toJson: `${camelcase(context.name as string)}`,
        fromJson: `json['${context.name}']`,
      };
    }
    const nullSchemaIndex = schemas.findIndex((schema) => {
      if (isRef(schema)) {
        const refSchema = followRef(this.#spec, schema.$ref);
        return refSchema.type === 'null';
      }
      return schema.type === 'null';
    });
    const anyOfSchemas = schemas.slice(0);
    if (nullSchemaIndex >= 0) {
      anyOfSchemas.splice(nullSchemaIndex, 1); // remove null schema
    }

    return this.handle(className, anyOfSchemas[0], true, {
      ...context,
      nullable: nullSchemaIndex >= 0,
    });
  }

  #mixinise(name: string, context: Context) {
    const mixins = this.#getRefUsage(name);
    if (context.mixin) {
      mixins.unshift(context.mixin);
    }
    const withMixins =
      mixins.length > 1
        ? ` with ${mixins.join(', ')}`
        : mixins.length === 1
          ? `extends ${mixins[0]}`
          : '';
    return {
      withMixins,
      mixins,
    };
  }

  #oneOf(
    className: string,
    schemas: (SchemaObject | ReferenceObject)[],
    context: Context,
  ): Serialized {
    const name = pascalcase(context.propName || className); // className in case is top level

    if (schemas.length === 0) {
      return {
        content: '',
        nullable: false,
        use: 'dynamic',
        toJson: `${camelcase(context.name as string)}`,
        fromJson: `json['${context.name}']`,
      };
    }
    const content: string[] = [];
    const patterns: { pattern: string; name: string }[] = [];
    // FIXME: if there is just one type then no need to add the discriminator
    const objects = schemas.filter(notRef).filter((it) => it.type === 'object');
    for (const schema of schemas) {
      if (isRef(schema)) {
        const refType = this.#ref(className, schema.$ref, true, context);
        patterns.push({
          pattern: `case ${refType.type || 'Map<String, dynamic>'} map when ${refType.use}.matches(map): return ${refType.use}.fromJson(map);`,
          name: refType.use,
        });
      } else if (schema.type === 'string') {
        // todo: make this into a schema with ref (preproccesing)
        content.push(`class ${name}Text with ${name} {
          final String value;
          ${name}Text(this.value);
          @override
          dynamic toJson() => value;
          static bool matches(dynamic value) {
    return value is String;
        }}
          `);
        patterns.push({
          pattern: `case String(): return ${name}Text(json);`,
          name: `${name}Text`,
        });
      } else if (schema.type === 'array') {
        // todo: make this into a schema with ref (preproccesing) with all varients types (integer, string)
        // todo: this can be abstracted so the varients somehow dynamic without having to replicate the same classes all the time
        const itemsType = this.handle(name, schema.items!, true, {
          ...context,
          noEmit: true,
        });
        content.push(`class ${name}List with ${name} {
            final List<${itemsType.use}> value;
            ${name}List(this.value);
            @override
            dynamic toJson() => value;
  static bool matches(dynamic value) {
    return value is List;
        }}`);
        patterns.push({
          pattern: `case List(): return ${name}List(List<${itemsType.use}>.from(json));`,
          name: `${name}List`,
        });
      }
    }
    if (objects.length) {
      // todo: take a look at CompoundFilterFilters at the end
      const candidates: Record<string, Set<string>> = {};
      for (const schema of objects) {
        if (schema.additionalProperties === true) {
          continue;
        }
        assert(
          schema.properties,
          `Schema ${name} has no properties which are required in oneOf in order to determine the discriminator.`,
        );
        for (const [propName, propSchema] of Object.entries(
          schema.properties,
        )) {
          if (
            notRef(propSchema) &&
            propSchema.enum &&
            // fixme: the enum can have more than one value as long as it is not duplicated else where on the other schemas
            propSchema.enum.length === 1
          ) {
            candidates[propName] ??= new Set();
            candidates[propName].add(String(propSchema.enum[0]));
          }
        }
      }

      let discriminatorProp: string | undefined;

      for (const [name, values] of Object.entries(candidates)) {
        if (
          // make sure we pick the prop that exists on all objects
          values.size === objects.filter((it) => it.properties?.[name]).length
        ) {
          discriminatorProp = name;
          break;
        }
      }

      // if (objects.filter((it) => it.additionalProperties !== true).length) {
      // }
      // assert(discriminatorProp, `No discriminator property found in ${name}`);

      if (discriminatorProp) {
        for (const schema of objects) {
          const discriminatorValue: string = (
            (schema as SchemaObject).properties![
              discriminatorProp!
            ] as SchemaObject
          ).enum?.[0];

          const varientName = `${name}${pascalcase(discriminatorValue)}`;
          patterns.push({
            pattern: `case Map<String, dynamic> map when ${varientName}.matches(json): return ${varientName}.fromJson(map);`,
            name: varientName,
          });

          const objResult = this.#object(varientName, schema, {
            ...context,
            noEmit: true,
            mixin: name,
          });
          content.push(objResult.content);
        }
      }
    }

    const { mixins, withMixins } = this.#mixinise(name, context);
    content.unshift(`abstract ${mixins.length ? '' : 'mixin'} class ${name} ${withMixins} {
      dynamic toJson();
      ${
        patterns.length
          ? `static ${name} fromJson(dynamic json) {
      switch (json){
        ${patterns.map((it) => it.pattern).join('\n')}
        default:
          throw ArgumentError("Invalid type for query property: \${json}");
        }
      }


     ${
       patterns.length
         ? ` static bool matches(dynamic value) {
        return ${patterns.map((it) => `value is ${it.name}`).join(' || ')};
      }`
         : ''
     }

      `
          : ''
      }
    }`);
    this.#emit(name, content.join('\n'));

    return {
      content: content.join('\n'),
      use: name,
      toJson: `${this.#safe(context.name as string, context.required)}`,
      fromJson: `${name}.fromJson(json['${context.name}'])`,
      matches: `${name}.matches(json['${context.name}'])`,
    };
  }

  #simple(type: string) {
    switch (type) {
      case 'string':
        return 'String';
      case 'number':
        return 'double';
      case 'integer':
        return 'int';
      case 'boolean':
        return 'bool';
      default:
        return 'dynamic';
    }
  }

  #enum(className: string, schema: SchemaObject, context: Context): Serialized {
    const name = context.propName || className; // className in case enum is top level
    const values = schema.enum as string[];
    const valType = this.#simple((schema.type as string) || 'string');
    // fixme: if enum have one value and cannot be null then use it as default value

    const { mixins, withMixins } = this.#mixinise(className, context);

    const content = `
  class _EnumValue implements ${pascalcase(name)} {
  final ${valType} value;
  const _EnumValue(this.value);
  @override
  toJson() {return this.value;}
}
    abstract ${mixins.length ? '' : 'mixin'} class ${pascalcase(name)} ${withMixins} {
      ${values.map((it) => `static const _EnumValue ${snakecase(formatName(it))} = _EnumValue(${typeof it === 'number' ? it : `'${it}'`});`).join('\n')}
      dynamic toJson();

      ${valType} get value;

      static _EnumValue fromJson(${valType} value) {
      switch (value) {
${values
  .map(
    (it) =>
      `case ${typeof it === 'number' ? it : `'${it}'`}: return ${snakecase(formatName(it))};`,
  )
  .join('\n')}
default:
  throw ArgumentError.value(value, "value", "No enum value with that name");
      }
    }

    static bool matches(${valType} value) {
      try {
fromJson(value);
return true;
      } catch (error) {
return false;
      }
  }

    }`;
    if (context.noEmit !== true) {
      this.#emit(name, content);
    }
    return {
      type: Array.isArray(schema.type)
        ? this.#simple(schema.type[0])
        : schema.type
          ? this.#simple(schema.type)
          : undefined,
      content: content,
      use: pascalcase(name),
      toJson: `${context.required ? `this.${camelcase(context.name)}.toJson()` : `this.${camelcase(context.name)} != null ? this.${camelcase(context.name)}!.toJson() : null`}`,
      fromJson: `${pascalcase(name)}.fromJson(json['${context.name}'])`,
      matches: `${pascalcase(name)}.matches(json['${context.name}'])`,
    };
  }

  /**
   * Handle string type with formats
   */
  #string(schema: SchemaObject, context: Context): Serialized {
    const safeName = context.safeName || context.name;
    switch (schema.format) {
      case 'date-time':
      case 'datetime':
      case 'date':
        return {
          content: '',
          use: 'DateTime',
          simple: true,
          toJson: context.required
            ? `this.${safeName}.toIso8601String()`
            : `this.${safeName} != null ? this.${safeName}!.toIso8601String() : null`,
          fromJson: context.name
            ? `json['${context.name}'] != null ? DateTime.parse(json['${context.name}']) : null`
            : 'json',
          matches: `json['${context.name}'] is String`,
        };
      case 'binary':
      case 'byte':
        return {
          content: '',
          use: 'File',
          toJson: `this.${safeName}`,
          simple: true,
          fromJson: context.name ? `json['${context.name}']` : 'json',
          matches: `json['${context.name}'] is Uint8List`,
        };
      default:
        return {
          encode: 'input',
          use: `String`,
          content: '',
          simple: true,
          toJson: `this.${safeName}`,
          fromJson: context.name ? `json['${context.name}'] as String` : 'json',
          matches: `json['${context.name}'] is String`,
        };
    }
  }

  /**
   * Handle number/integer types with formats
   */
  number(schema: SchemaObject, context: Context): Serialized {
    if (schema.type === 'integer') {
      return {
        content: '',
        use: 'int',
        simple: true,
        toJson: `this.${camelcase(context.name)}`,
        fromJson: `json['${context.name}']`,
        matches: `json['${context.name}'] is int`,
      };
    }
    if (['float', 'double'].includes(schema.format as string)) {
      return {
        content: '',
        use: 'double',
        simple: true,
        toJson: `this.${camelcase(context.name)}`,
        fromJson: `json['${context.name}']`,
        matches: `json['${context.name}'] is double`,
      };
    }
    return {
      content: '',
      use: 'num',
      simple: true,
      toJson: `this.${camelcase(context.name)}`,
      fromJson: `json['${context.name}']`,
      matches: `json['${context.name}'] is double`,
    };
  }

  #serialize(
    className: string,
    schema: SchemaObject | ReferenceObject,
    required = true,
    context: Context = {},
  ): Serialized {
    if (isRef(schema)) {
      return this.#ref(className, schema.$ref, required, context);
    }
    // some schemas have decalres allof, oneof, anyOf at once or combinations of them
    // so we need to process them in order
    if (schema.allOf && Array.isArray(schema.allOf)) {
      return this.#allOf(className, schema.allOf, context);
    }
    if (schema.oneOf && Array.isArray(schema.oneOf)) {
      return this.#oneOf(className, schema.oneOf, context);
    }
    if (schema.anyOf && Array.isArray(schema.anyOf)) {
      return this.#anyOf(className, schema.anyOf, context);
    }
    if (schema.enum && Array.isArray(schema.enum)) {
      return this.#enum(className, schema, context);
    }
    // Handle types
    const types = Array.isArray(schema.type)
      ? schema.type
      : schema.type
        ? [schema.type]
        : [];

    let nullable = false;
    if ('nullable' in schema && schema.nullable) {
      nullable = true;
    } else if (schema.default === null) {
      nullable = true;
    } else if (types.includes('null')) {
      nullable = true;
    }

    // If no explicit "type", fallback to dynamic
    if (!types.length) {
      // unless properties are defined then assume object
      if ('properties' in schema) {
        return this.#object(className, schema, context);
      }
      if ('items' in schema) {
        return this.#array(className, schema, true, context);
      }
      return {
        content: '',
        use: 'dynamic',
        toJson: `${camelcase(context.name as string)}`,
        fromJson: `json['${context.name}']`,
        nullable: false,
        matches: '', // keep it empty as 'type is dynamic' is always true
      };
    }
    return this.#primitive(
      className,
      types[0],
      schema,
      { ...context, nullable },
      required,
    );
  }

  handle(
    className: string,
    schema: SchemaObject | ReferenceObject,
    required = true,
    context: Context = {},
  ): Serialized {
    const alias = context.alias;
    context.alias = undefined;
    const serialized = this.#serialize(className, schema, required, {
      ...context,
      forJson: alias,
    });

    if (alias) {
      this.#emit(className, `typedef ${alias} = ${serialized.use};`);
      return serialized;
    }
    return serialized;
  }
}

export function isObjectSchema(
  schema: SchemaObject | ReferenceObject,
): schema is SchemaObject {
  return !isRef(schema) && (schema.type === 'object' || !!schema.properties);
}
