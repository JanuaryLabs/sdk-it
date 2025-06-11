import deubg from 'debug';
import { merge } from 'lodash-es';
import assert from 'node:assert';
import type {
  OpenAPIObject,
  ReferenceObject,
  SchemaObject,
  SchemaObjectType,
} from 'openapi3-ts/oas31';
import { camelcase, snakecase } from 'stringcase';

import {
  followRef,
  isEmpty,
  isRef,
  joinSkipDigits,
  notRef,
  parseRef,
  pascalcase,
  resolveRef,
} from '@sdk-it/core';
import { type Varient, coerceTypes } from '@sdk-it/spec';

const log = deubg('dart-serializer');

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
const STARTS_WITH_DIGITS_PATTERN = /^-?\d/;
const FIRST_DASH = /^_/;
const LAST_DASH = /_$/;
const ONLY_ENGLISH = /(^\$)|[^A-Za-z0-9]+/g;

const formatName = (it: any): string => {
  if (reservedWords.has(it)) {
    return `$${it}`;
  }
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
    if (STARTS_WITH_DIGITS_PATTERN.test(it)) {
      if (typeof it === 'number') {
        // if negative number, prefix with $_
        if (Math.sign(it) === -1) {
          return `$_${Math.abs(it)}`;
        }
      }
      // positive number or string starting with digit, prefix with $
      return `$${it}`;
    }

    return it
      .replace(ONLY_ENGLISH, (_m, g1) => (g1 === '$' ? '$' : '_'))
      .replace(FIRST_DASH, '')
      .replace(LAST_DASH, '');
  }

  // 4. Fallback for any other types (e.g., null, undefined, objects)
  // Convert to string first, then apply snakecase
  return String(it);
};

type Context = Record<string, any>;
type Serialized = {
  nullable?: boolean;
  encode?: string;
  encodeV2?: string;
  use: string;
  matches?: string;
  fromJson: string;
  type?: string;
  literal?: unknown;
  content: string;
  simple?: boolean;
};
type Emit = (name: string, content: string, schema: SchemaObject) => void;
/**
 * Convert an OpenAPI (JSON Schema style) object into Dart classes
 */
export class DartSerializer {
  #spec: OpenAPIObject;
  #emit: Emit;
  #generatedRefs = new Map<string, Serialized | null>();

  constructor(spec: OpenAPIObject, emit: Emit) {
    this.#spec = spec;
    this.#emit = emit;
  }

  #getRefUsage(schemaName: string, list: string[] = []): string[] {
    this.#spec.components ??= {};
    this.#spec.components.schemas ??= {};
    this.#spec.components.responses ??= {};

    const checkSchema = (
      schema: SchemaObject | ReferenceObject,
      withRefCheck = false,
    ): any => {
      if (isRef(schema)) {
        if (!withRefCheck) return false;
        const { model } = parseRef(schema.$ref);
        return model === schemaName;
      }
      if (!isEmpty(schema.oneOf)) {
        return schema.oneOf.some((it) => checkSchema(it, true));
      }
      if (schema.type === 'array' && schema.items) {
        if (isRef(schema.items)) {
          return checkSchema(schema.items, withRefCheck);
        }
        if (schema.items.oneOf) {
          return schema.items.oneOf.some((it) => checkSchema(it, true));
        }
        return checkSchema(schema.items, withRefCheck);
      }

      if (schema.type === 'object') {
        if (schema.properties) {
          let found = false;
          let propertyName = '';
          for (const [key, it] of Object.entries(schema.properties)) {
            found = checkSchema(it, false);
            if (found) {
              propertyName = key;
            }
          }
          return propertyName;
        }
      }
      return false;
    };

    for (const [key, value] of Object.entries(this.#spec.components.schemas)) {
      const thisWouldBeTheObjectPropertyKeyName = checkSchema(value);
      if (thisWouldBeTheObjectPropertyKeyName) {
        if (typeof thisWouldBeTheObjectPropertyKeyName === 'string') {
          list.push(
            pascalcase(`${key} ${thisWouldBeTheObjectPropertyKeyName}`),
          );
        } else {
          list.push(pascalcase(key));
        }
      }
    }

    return list;
  }

  #formatKeyName(name: string): string {
    if (name.startsWith('$')) {
      return `\\${name}`;
    }
    return name;
  }

  #object(
    className: string,
    schema: SchemaObject,
    context: Context,
  ): Serialized {
    if (schema.additionalProperties) {
      if (context.requestize) {
        return this.#object(
          className,
          {
            type: 'object',
            properties: {
              $body: { 'x-special': true },
            },
          },
          context,
        );
      }

      if (context.noEmit !== true && !context.propName) {
        // only emit if root level not for individual properties
        this.#emit(
          className,
          `typedef ${className} = Map<String, dynamic>;`,
          schema,
        );
      }

      return {
        content: '',
        use: 'Map<String, dynamic>',
        encode: 'input',
        encodeV2: '',
        fromJson: context.name
          ? `json['${context.jsonKey || context.name}']`
          : 'json',
        matches: `json['${camelcase(context.name)}'] is Map<String, dynamic>`,
      };
    }

    if (isEmpty(schema.properties)) {
      if (context.noEmit !== true) {
        this.#emit(
          className,
          `class ${className} {
  const ${className}();

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
          schema,
        );
      }
      return {
        content: '',
        encode: 'input.toJson()',
        use: className,
        encodeV2: context.required ? '' : '?' + '.toJson()',
        fromJson: `${className}.fromJson(json)`,
        matches: `${className}.matches(json)`,
      };
    }

    let requestContent = '';
    const props: string[] = [];
    const toJsonProperties: string[] = [];
    const constructorParams: string[] = [];
    const fromJsonParams: string[] = [];
    const matches: string[] = [];

    const headers: string[] = [];
    const params: string[] = [];
    const queryParams: string[] = [];
    const bodyParams: string[] = [];

    for (const [key, propSchema] of Object.entries(schema.properties)) {
      const propName = key.replace('[]', '');
      const safePropName = camelcase(formatName(propName));
      const required = (schema.required ?? []).includes(key);
      const jsonKey = this.#formatKeyName(propName);

      const serializedType = this.handle(className, propSchema, required, {
        name: propName,
        safeName: safePropName,
        jsonKey: jsonKey,
        required,
        propName: joinSkipDigits([className, propName], '_'),
        parsable: `json['${jsonKey}']`,
      });
      const nullable = serializedType.nullable || !required;
      const nullableSuffix =
        serializedType.use === 'dynamic' ? '' : nullable ? '?' : ''; // dynamic types requires no suffix
      const withValue =
        serializedType.literal !== undefined
          ? ` = ${serializedType.literal}`
          : '';
      props.push(
        `final ${serializedType.use}${nullableSuffix} ${safePropName} ${withValue};`,
      );
      toJsonProperties.push(
        `'${jsonKey}': ${safePropName}${serializedType.encodeV2}`,
      );
      if (!withValue) {
        fromJsonParams.push(`${safePropName}: ${serializedType.fromJson}`);
        constructorParams.push(
          `${required ? 'required ' : ''}this.${safePropName},`,
        );
      }
      if (required) {
        matches.push(`(
  json.containsKey('${jsonKey}')
  ? ${nullable ? `json['${jsonKey}'] == null` : `json['${jsonKey}'] != null`} ${serializedType.matches ? `&& ${serializedType.matches}` : ''}
  : false)`);
      } else {
        matches.push(`(
  json.containsKey('${jsonKey}')
  ? ${nullable ? `json['${jsonKey}'] == null` : `json['${jsonKey}'] != null`} ${serializedType.matches ? `|| ${serializedType.matches}` : ''}
  : true)`);
      }

      const { 'x-in': source, 'x-special': special } =
        propSchema as SchemaObject;
      if (source) {
        switch (source) {
          case 'header':
            headers.push(`'${jsonKey}': ${safePropName}`);
            break;
          case 'path':
            params.push(`'${jsonKey}': ${safePropName}`);
            break;
          case 'query':
            queryParams.push(`'${jsonKey}': ${safePropName}`);
            break;
          default:
            bodyParams.push(`'${jsonKey}': ${safePropName}`);
        }
      } else {
        if (special) {
          bodyParams.push(`$body${serializedType.encodeV2!}`);
        } else {
          bodyParams.push(
            `'${jsonKey}': ${safePropName}${serializedType.encodeV2}`,
          );
        }
      }
    }

    if (context.requestize) {
      const body =
        bodyParams.length === 1 && bodyParams[0].startsWith('$body')
          ? bodyParams[0]
          : `${bodyParams.length ? `{${bodyParams.join(', ')}}` : '{}'}`;

      requestContent = `
        RequestInput toRequest() =>
           RequestInput(
          headers: ${headers.length ? `{${headers.join(', ')}}` : '{}'},
          query: ${queryParams.length ? `{${queryParams.join(', ')}}` : '{}'},
          params: ${params.length ? `{${params.join(', ')}}` : '{}'},
          body: ${body}
    );`;
    }

    const constructorP = constructorParams.length
      ? `{${constructorParams.join('\n')}}`
      : '';

    const { mixins, withMixins } = this.#mixinise(className, context);
    const content = `class ${className} ${withMixins} {
      ${props.join('\n')}
      ${!mixins.length ? 'const' : ''} ${className}(${constructorP})${mixins.length > 1 ? '' : `:super()`};
       factory ${className}.fromJson(Map<String, dynamic> json) {
return ${className}(\n${fromJsonParams.join(',\n')});
      }
      Map<String, dynamic> toJson() => {
${toJsonProperties.join(',\n')}
      };
      static bool matches(Map<String, dynamic> json) {return ${matches.join(' && ')};}

      ${requestContent}

    }`;
    if (context.noEmit !== true) {
      this.#emit(className, content, schema);
    }
    const nullable = !context.required || context.nullable === true;
    const generatedClassName = context.forJson || className;
    return {
      use: className,
      content,
      encode: 'input.toJson()',
      encodeV2: `${context.required ? '' : '?'}.toJson()`,
      fromJson: context.name
        ? `${generatedClassName}.fromJson(${context.parsable})`
        : `${generatedClassName}.fromJson(json)`,
      matches: context.parsable
        ? `${generatedClassName}.matches(${context.parsable})`
        : `${generatedClassName}.matches(json['${context.jsonKey || context.name}'])`,
    };
  }

  #oneOfObject(
    className: string,
    varientName: string,
    schema: SchemaObject,
    context: Context,
  ) {
    const entries = Object.entries(schema.properties || {});
    if (entries.length === 1) {
      const [key, prop] = entries[0];
      const serializedType = this.handle(
        pascalcase(`${className} ${varientName}`),
        prop,
        true,
        {
          ...context,
          propName: joinSkipDigits([varientName, key], '_'),
          safeName: varientName,
          parsable: `json['${varientName}']`,
        },
      );
      return {
        typeStr: `${serializedType.use}${serializedType.nullable ? '?' : ''} ${key}`,
        returnValue: `_Value({'${key}': ${key}${serializedType.encodeV2}});`,
        fromJson: serializedType.fromJson,
      };
    }
    const result = this.handle(
      pascalcase(`${className} ${varientName}`),
      schema,
      true,
      {
        ...context,
        jsonKey: varientName,
        parsable: `json['${varientName}']`,
      },
    );
    return {
      typeStr: `${result.use} value`,
      returnValue: `_Value(value.toJson());`,
      fromJson: result.fromJson,
    };
  }

  #array(
    className: string,
    schema: SchemaObject,
    required = false,
    context: Context,
  ): Serialized {
    const jsonKey = context.jsonKey || context.name;

    if (!schema.items) {
      return {
        content: '',
        use: 'List<dynamic>',
        encodeV2: '',
        fromJson: `List<dynamic>.from(${context.name ? `json['${context.jsonKey || context.name}']` : `json`})`,
        matches: '',
      };
    }
    const itemsType = this.handle(className, schema.items, true, {
      ...context,
      parsable: 'it',
    });
    const fromJson = required
      ? context.name
        ? `(json['${jsonKey}'] as List)
            .map((it) => ${itemsType.simple ? `it as ${itemsType.use}` : `${itemsType.fromJson}`})
            .toList()`
        : `(json as List)
            .map((it) => ${itemsType.simple ? `it as ${itemsType.use}` : `${itemsType.fromJson}`})
            .toList()`
      : context.name
        ? `json['${jsonKey}'] != null
            ? (json['${jsonKey}'] as List)
                .map((it) => ${itemsType.simple ? `it as ${itemsType.use}` : `${itemsType.fromJson}`})
                .toList()
            : null`
        : `json != null
            ? (json as List)
                .map((it) => ${itemsType.simple ? `it as ${itemsType.use}` : `${itemsType.fromJson}`})
                .toList()
            : null`;

    return {
      encode: `input.map((it) => ${itemsType.simple ? 'it' : `it.toJson()`}).toList()`,
      content: '',
      use: `List<${itemsType.use}>`,
      fromJson,
      simple: true,
      encodeV2: `${itemsType.simple ? '' : `${context.required ? '' : '?'}.map((it) => ${itemsType.simple ? 'it' : `it.toJson()`}).toList()`}`,
      matches: context.parsable
        ? `(${context.parsable} as List).every((it) => ${itemsType.matches})`
        : `json['${jsonKey}'] is List && json['${jsonKey}'].every((it) => ${itemsType.matches})`,
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
    switch (type) {
      case 'string':
        return this.#string(schema, context);
      case 'number':
      case 'integer':
        return this.#number(schema, context);
      case 'boolean':
        return {
          content: '',
          use: 'bool',
          encodeV2: '',
          simple: true,
          fromJson: context.name
            ? `json['${context.jsonKey || context.name}']`
            : 'json',
          matches: `json['${context.jsonKey || context.name}'] is bool`,
        };
      case 'object':
        return this.#object(className, schema, context);
      case 'array':
        return this.#array(className, schema, required, context);
      case 'null':
        return {
          content: '',
          encodeV2: '',
          simple: true,
          use: 'Null',
          fromJson: context.name
            ? `json['${context.jsonKey || context.name}']`
            : 'json',
        };
      default:
        // Unknown type -> fallback
        return {
          content: '',
          use: 'dynamic',
          encodeV2: '',
          simple: true,
          fromJson: context.name
            ? `json['${context.jsonKey || context.name}']`
            : 'json',
          matches: '',
          nullable: false,
        };
    }
  }

  #ref(
    className: string,
    $ref: string,
    required: boolean,
    context: Context,
  ): Serialized {
    const { model: schemaName } = parseRef($ref);
    const schema = followRef(this.#spec, $ref);
    const types = coerceTypes(schema, false);
    const isSimple = (
      ['string', 'number', 'integer', 'array', 'boolean', 'null'] as const
    ).some((it) => types.includes(it));
    if (isSimple) {
      return this.handle(pascalcase(schemaName), schema, required, {
        ...context,
        propName: schemaName,
        noEmit: !!context.alias || !!className || !context.forceEmit,
      });
    }
    const generatedClassName = context.forJson || pascalcase(schemaName);

    return {
      use: pascalcase(schemaName),
      content: '',
      encode: 'input.toJson()',
      encodeV2: schema.additionalProperties
        ? ''
        : `${context.required ? '' : '?'}.toJson()`,
      fromJson: schema.additionalProperties
        ? `${generatedClassName}.from(json)`
        : `${generatedClassName}.fromJson(${context.parsable || 'json'})`,
      matches: schema.additionalProperties
        ? `${context.parsable} is ${generatedClassName}`
        : `${generatedClassName}.matches(${context.parsable || context.jsonKey || context.name})`,
      simple: !!schema.additionalProperties,
    };
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

  #mixinise(name: string, context: Context) {
    const mixins = this.#getRefUsage(name);
    if (context.mixin) {
      mixins.unshift(context.mixin);
    }
    const withMixins =
      mixins.length > 1
        ? ` implements ${mixins.join(', ')}`
        : mixins.length === 1
          ? `extends ${mixins[0]}`
          : '';
    return {
      withMixins,
      mixins,
    };
  }

  #buildClass(options: {
    name: string;
    abstract?: boolean;
    mixins: string[];
    withMixins?: string;
    content: string;
  }) {
    return [
      options.abstract ? 'abstract' : '',
      options.mixins.length ? '' : 'mixin',
      `class ${options.name} ${options.withMixins}`,
      '{',
      options.content,
      '}',
    ]
      .filter(Boolean)
      .join('\n');
  }

  #oneOf(
    className: string,
    schema: SchemaObject,
    context: Context,
  ): Serialized {
    const varients: Varient[] = schema['x-varients'];
    const schemas = schema.oneOf || schema.anyOf || [];
    const name = pascalcase(context.propName || className); // className in case is top level
    log(`#oneOf ${name}`);
    if (schemas.length === 0) {
      return {
        content: '',
        nullable: false,
        use: 'dynamic',
        encodeV2: '',
        fromJson: `json['${context.jsonKey || context.name}']`,
      };
    }

    const content: string[] = [];
    const patterns: { pattern: string; name: string }[] = [];

    content.push(`class _Value implements ${pascalcase(name)} {
  final dynamic value;
  const _Value(this.value);
  @override
  toJson() => value;
}`);

    for (const { name: varientName, ...varient } of varients) {
      switch (varientName) {
        case 'empty':
          patterns.push({
            name: `static ${name} ${formatName(varientName)}() => _Value("");`,
            pattern: `case '': return ${name}.${formatName(varientName)}();`,
          });
          continue;
        case 'uri':
          patterns.push({
            name: `static ${name} ${formatName(varientName)}(Uri value) => _Value(value);`,
            pattern: `case String: return ${name}.${formatName(varientName)}(Uri.parse(json));`,
          });
          continue;
        case 'number':
          patterns.push({
            name: `static ${name} ${formatName(varientName)}(num value) => _Value(value);`,
            pattern: `case num: return ${name}.${formatName(varientName)}(json);`,
          });
          continue;
        case 'object': {
          const objectSchema = resolveRef(
            this.#spec,
            schemas[varient.position],
          );
          const result = this.#object(
            pascalcase(`${name} ${formatName(varientName)}`),
            objectSchema,
            { ...context, noEmit: false },
          );
          patterns.push({
            name: `static ${name} ${formatName(varientName)}(${result.use} value) => _Value(value);`,
            pattern: `case Map<String, dynamic> map: return ${name}.${formatName(varientName)}(${pascalcase(
              `${name} ${formatName(varientName)}`,
            )}.fromJson(map));`,
          });
          continue;
        }
      }
      switch (varient.type) {
        case 'string':
          patterns.push({
            name: `static ${name} ${formatName(varientName)}(String value) => _Value(value);`,
            pattern: `case String: return ${name}.${formatName(varientName)}(json);`,
          });
          break;
        case 'object': {
          const objectSchema = resolveRef(
            this.#spec,
            schemas[varient.position],
          );
          const { typeStr, returnValue, fromJson } = this.#oneOfObject(
            name,
            formatName(varientName),
            objectSchema,
            context,
          );
          const staticStr = varient.static
            ? `&& json['${varient.source}'] == '${formatName(varientName)}'`
            : '';
          const caseStr = `case Map<String, dynamic> _ when json.containsKey('${varient.source}') ${staticStr}`;

          const returnStr = `return ${name}.${formatName(varientName)}(${fromJson})`;
          patterns.push({
            name: `static ${name} ${formatName(varientName)}(${typeStr}) => ${returnValue}`,
            pattern: `${caseStr}: ${returnStr};`,
          });
          break;
        }
        case 'array': {
          patterns.push({
            name: `static ${name} ${formatName(varientName)}(String value) => _Value(value);`,
            pattern: `case String: return ${name}.${formatName(varientName)}(json);`,
          });
          break;
        }
        default: {
          //
        }
      }
    }
    const { mixins, withMixins } = this.#mixinise(name, context);
    content.push(
      this.#buildClass({
        name,
        abstract: true,
        mixins,
        withMixins,
        content: [
          // 'dynamic get value;',
          'dynamic toJson();',

          ...patterns.map((it) => it.name),
          `${name}();`,
          `factory ${name}.fromJson(dynamic json)`,
          `{`,
          `switch (json) {`,
          ...patterns.map((it) => it.pattern),
          `default: throw ArgumentError("Invalid type: \${json}");`,
          `}`,
          `}`,
          `static bool matches(dynamic value) {
    try {
      ${name}.fromJson(value);
      return true;
    } catch (error) {
      return false;
    }
  }`,
        ].join('\n'),
      }),
    );

    this.#emit(name, content.join('\n'), { oneOf: schemas } as SchemaObject);
    const jsonKey = context.jsonKey || context.name;
    return {
      content: content.join('\n'),
      use: name,
      encodeV2: `${context.required ? '' : '?'}.toJson()`,
      fromJson: context.parsable
        ? `${name}.fromJson(${context.parsable})`
        : context.name
          ? `${name}.fromJson(json['${jsonKey}'])`
          : `${name}.fromJson(json)`,
      matches: context.parsable
        ? `${name}.matches(${context.parsable})`
        : `${name}.matches(json['${context.jsonKey || context.name}'])`,
    };
  }

  #simple(type: SchemaObjectType) {
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
    const valType = this.#simple(coerceTypes(schema)[0]);
    // fixme: if enum have one value and cannot be null then use it as default value

    const { mixins, withMixins } = this.#mixinise(name, context);

    const content = `
  class _EnumValue implements ${pascalcase(name)} {
  final ${valType} value;
  const _EnumValue(this.value);
  @override
  toJson() => value;
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
      this.#emit(name, content, schema);
    }
    return {
      type: this.#simple(coerceTypes(schema)[0]),
      content: content,
      use: pascalcase(name),
      encodeV2: `${context.required ? '' : '?'}.toJson()`,
      fromJson: context.parsable
        ? `${pascalcase(name)}.fromJson(${context.parsable})`
        : context.name
          ? `${pascalcase(name)}.fromJson(json['${context.jsonKey || context.name}'])`
          : `${pascalcase(name)}.fromJson(json)`,
      matches: context.parsable
        ? `${pascalcase(name)}.matches(${context.parsable})`
        : `${pascalcase(name)}.matches(json['${context.jsonKey || context.name}'])`,
    };
  }

  #const(
    className: string,
    schema: SchemaObject,
    context: Context,
  ): Serialized {
    const valType = this.#simple(coerceTypes(schema)[0]);
    return {
      content: '',
      literal: valType === 'String' ? `'${schema.const}'` : schema.const,
      use: valType,
      encode: 'input',
      encodeV2: '',
      fromJson: context.name
        ? `json['${context.jsonKey || context.name}']`
        : 'json',
      matches: `json['${context.jsonKey || context.name}']`,
      simple: true,
    };
  }

  /**
   * Handle string type with formats
   */
  #string(schema: SchemaObject, context: Context): Serialized {
    const safeName = context.safeName || context.name;
    const jsonKey = context.jsonKey || context.name;
    switch (schema.format) {
      case 'date-time':
      case 'datetime':
      case 'date':
        return {
          content: '',
          use: 'DateTime',
          simple: true,
          encodeV2: `${context.required ? '' : '?'}.toIso8601String()`,
          fromJson: jsonKey
            ? context.required
              ? `DateTime.parse(json['${jsonKey}'])`
              : `json['${jsonKey}'] != null ? DateTime.parse(json['${jsonKey}']) : null`
            : 'json',
          matches: `json['${jsonKey}'] is String`,
        };
      case 'binary':
      case 'byte':
        return {
          content: '',
          use: 'File',
          encodeV2: '',
          simple: true,
          fromJson: context.name
            ? `json['${context.jsonKey || context.name}']`
            : 'json',
          matches: `json['${context.jsonKey || context.name}'] is Uint8List`,
        };
      default:
        return {
          encode: 'input',
          use: `String`,
          content: '',
          encodeV2: '',
          simple: true,
          fromJson: context.name
            ? `json['${context.jsonKey || context.name}'] as String`
            : 'json',
          matches: `json['${context.jsonKey || context.name}'] is String`,
        };
    }
  }

  /**
   * Handle number/integer types with formats
   */
  #number(schema: SchemaObject, context: Context): Serialized {
    if (schema.type === 'integer') {
      return {
        content: '',
        use: 'int',
        simple: true,
        encodeV2: '',
        fromJson: context.parsable
          ? `json['${context.jsonKey || context.name}']`
          : 'json',
        matches: context.parsable
          ? `${context.parsable} is int`
          : `json['${context.jsonKey || context.name}'] is int`,
      };
    }
    if (['float', 'double'].includes(schema.format as string)) {
      return {
        content: '',
        use: 'double',
        simple: true,
        encodeV2: '',
        fromJson: context.name
          ? `json['${context.jsonKey || context.name}']`
          : 'json',
        matches: context.parsable
          ? `${context.parsable} is double`
          : `json['${context.jsonKey || context.name}'] is double`,
      };
    }
    return {
      content: '',
      use: 'num',
      simple: true,
      encodeV2: '',
      fromJson: context.name
        ? `json['${context.jsonKey || context.name}']`
        : 'json',
      matches: context.parsable
        ? `${context.parsable} is double`
        : `json['${context.jsonKey || context.name}'] is double`,
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
      return this.#oneOf(className, schema, context);
    }
    if (schema.anyOf && Array.isArray(schema.anyOf)) {
      return this.#oneOf(className, schema, context);
    }
    if (schema.const !== undefined) {
      return this.#const(className, schema, context);
    }
    if (schema.enum && Array.isArray(schema.enum)) {
      return this.#enum(className, schema, context);
    }
    // Handle types
    const types = coerceTypes(schema, false);

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
        // Unknown type -> fallback
        content: '',
        use: 'dynamic',
        encodeV2: '',
        simple: true,
        fromJson: context.name
          ? `json['${context.jsonKey || context.name}']`
          : 'json',
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
      this.#emit(
        className,
        `typedef ${alias} = ${serialized.use};`,
        resolveRef(this.#spec, schema),
      );
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
