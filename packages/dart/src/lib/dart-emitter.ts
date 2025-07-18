import { merge } from 'lodash-es';
import assert from 'node:assert';
import type {
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
import {
  type IR,
  type Varient,
  coerceTypes,
  formatName,
  getRefUsage,
  isPrimitiveSchema,
  sanitizeTag,
} from '@sdk-it/spec';

export function coearceObject(schema: SchemaObject): SchemaObject {
  schema = structuredClone(schema);
  if (schema['x-properties']) {
    schema.properties = {
      ...(schema.properties ?? {}),
      ...(schema['x-properties'] ?? {}),
    };
  }
  if (schema['x-required']) {
    schema.required = Array.from(
      new Set([
        ...(Array.isArray(schema.required) ? schema.required : []),
        ...(schema['x-required'] || []),
      ]),
    );
  }
  return schema;
}

type Context = Record<string, any>;
type Serialized = {
  nullable?: boolean;
  encode?: string;
  encodeV2?: string;
  use: string;
  matches?: string;
  fromJson: any;
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
  #spec: IR;
  #emitHandler?: Emit;
  #emitHistory = new Set<string>();

  #emit(name: string, content: string, schema: SchemaObject): void {
    if (this.#emitHistory.has(content)) {
      return;
    }
    this.#emitHistory.add(content);
    this.#emitHandler?.(name, content, schema);
  }

  constructor(spec: IR) {
    this.#spec = spec;
  }

  onEmit(emit: Emit): void {
    this.#emitHandler = emit;
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
    const { properties = {}, required = [] } = coearceObject(schema);

    if (schema.additionalProperties || isEmpty(properties)) {
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
          pascalcase(formatName(className)),
          `typedef ${pascalcase(className)} = Map<String, dynamic>;`,
          schema,
        );
      }

      return {
        content: '',
        use: `Map<String, dynamic>`,
        encode: 'input',
        encodeV2: '',
        fromJson: context.parsable,
        matches: `${context.parsable} is Map<String, dynamic>`,
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

    for (const [key, propSchema] of Object.entries(properties)) {
      const propName = key.replace('[]', '');
      const safePropName = camelcase(formatName(propName));
      const requiredProp = required.includes(key);
      const jsonKey = this.#formatKeyName(propName);

      const serializedType = this.handle(className, propSchema, requiredProp, {
        name: propName,
        safeName: safePropName,
        required: requiredProp,
        propName: isRef(propSchema)
          ? pascalcase(propName)
          : joinSkipDigits([className, propName], '_'),
        parsable: `json['${jsonKey}']`,
      });
      const nullable = serializedType.nullable || !requiredProp;
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
          `${requiredProp ? 'required ' : ''}this.${safePropName},`,
        );
      }
      if (requiredProp) {
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

    // const { mixins, withMixins } = this.#mixinise(className, context);
    const fixedClassName = pascalcase(sanitizeTag(className));

    // ${!mixins.length ? 'const' : ''} ${fixedClassName}(${constructorP})${mixins.length > 1 ? '' : `:super()`};

    const content = `class ${fixedClassName} {
      ${props.join('\n')}
      const ${fixedClassName}(${constructorP}): super();
       factory ${fixedClassName}.fromJson(Map<String, dynamic> json) {
return ${fixedClassName}(\n${fromJsonParams.join(',\n')});
      }
      Map<String, dynamic> toJson() => {
${toJsonProperties.join(',\n')}
      };
      static bool matches(Map<String, dynamic> json) {return ${matches.join(' && ')};}

      ${requestContent}

    }`;
    if (context.noEmit !== true && !context.propName) {
      this.#emit(fixedClassName, content, schema);
    }
    const nullable = !context.required || context.nullable === true;
    const generatedClassName = context.forJson || className;
    return {
      use: fixedClassName,
      content,
      encode: 'input.toJson()',
      encodeV2: `${context.required ? '' : '?'}.toJson()`,
      fromJson: `${generatedClassName}.fromJson(${context.parsable})`,
      matches: `${generatedClassName}.matches(${context.parsable})`,
    };
  }

  #oneOfObject(
    className: string,
    varientName: string,
    schemaOrRef: SchemaObject | ReferenceObject,
    context: Context,
  ) {
    const schema = resolveRef(this.#spec, schemaOrRef);
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
    const serializedType = this.handle(className, schemaOrRef, true, {
      ...context,
      propName: joinSkipDigits([className, varientName], '_'),
      safeName: varientName,
      parsable: `json['${varientName}']`,
    });
    return {
      typeStr: `${serializedType.use} value`,
      returnValue: `_Value(value.toJson());`,
      fromJson: serializedType.fromJson,
    };
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
        encodeV2: '',
        fromJson: `List<dynamic>.from(${context.parsable})`,
        matches: '',
      };
    }
    const itemsType = this.handle(className, schema.items, true, {
      ...context,
      parsable: 'it',
    });
    const fromJson = required
      ? context.name
        ? `(${context.parsable} as List)
            .map((it) => ${itemsType.simple ? `it as ${itemsType.use}` : `${itemsType.fromJson}`})
            .toList()`
        : `(json as List)
            .map((it) => ${itemsType.simple ? `it as ${itemsType.use}` : `${itemsType.fromJson}`})
            .toList()`
      : context.name
        ? `${context.parsable} != null
            ? (${context.parsable} as List)
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
        : `${context.parsable} is List && ${context.parsable}.every((it) => ${itemsType.matches})`,
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
          fromJson: context.parsable,
          matches: `${context.parsable} is bool`,
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
          fromJson: context.parsable,
        };
      default:
        // Unknown type -> fallback
        return {
          content: '',
          use: 'dynamic',
          encodeV2: '',
          simple: true,
          fromJson: context.parsable,
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
    const schemaName = pascalcase(sanitizeTag(parseRef($ref).model));
    const schema = followRef(this.#spec, $ref);
    if (isPrimitiveSchema(schema)) {
      return this.handle(schemaName, schema, required, {
        ...context,
        propName: schemaName,
        noEmit: true,
        // default to json in case this method is root level
        parsable: context.parsable || 'json',
      });
    }
    const generatedClassName = context.forJson || schemaName;

    const isDynamicObject =
      schema.type === 'object'
        ? !!schema.additionalProperties || isEmpty(schema.properties)
        : schema.anyOf
          ? false
          : !schema.oneOf;
    return {
      use: pascalcase(schemaName),
      content: '',
      encode: 'input.toJson()',
      encodeV2: isDynamicObject
        ? ''
        : `${context.required ? '' : '?'}.toJson()`,
      fromJson: isDynamicObject
        ? `${generatedClassName}.from(json)`
        : `${generatedClassName}.fromJson(${context.parsable || 'json'})`,
      matches: isDynamicObject
        ? `${context.parsable} is ${generatedClassName}`
        : `${generatedClassName}.matches(${context.parsable})`,
      simple: isDynamicObject,
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
    const mixins = getRefUsage(this.#spec, name);
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
    mixins?: string[];
    withMixins?: string;
    content: string[];
    implements?: string[];
  }) {
    return [
      options.abstract ? 'abstract' : '',
      options.mixins?.length ? '' : 'mixin',
      `class ${options.name} ${options.withMixins} ${options.implements?.length ? `implements ${options.implements.join(', ')}` : ''}`,
      '{',
      options.content.join('\n'),
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
    const name = pascalcase(sanitizeTag(context.propName || className)); // className in case is top level
    if (schemas.length === 0) {
      return {
        content: '',
        nullable: false,
        use: 'dynamic',
        encodeV2: '',
        fromJson: context.parsable,
      };
    }

    const content: string[] = [];
    const patterns: { pattern: string; name: string }[] = [];

    content.push(`class _Value implements ${name} {
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
          // const objectSchema = resolveRef(
          //   this.#spec,
          //   schemas[varient.position],
          // );
          // const result = this.#object(
          //   pascalcase(`${name} ${formatName(varientName)}`),
          //   objectSchema,
          //   { ...context, noEmit: false },
          // );
          const result = this.handle(className, schemas[varient.position]);
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
          const { typeStr, returnValue, fromJson } = this.#oneOfObject(
            name,
            formatName(varientName),
            schemas[varient.position],
            context,
          );
          const staticStr = varient.static
            ? `&& json['${varient.source}'] == '${formatName(varientName)}'`
            : '';
          const caseStr = `case Map<String, dynamic> json when json.containsKey('${varient.source}') ${staticStr}`;

          const returnStr = `return ${name}.${formatName(varientName)}(${fromJson})`;
          patterns.push({
            name: `static ${name} ${formatName(varientName)}(${typeStr}) => ${returnValue}`,
            pattern: `${caseStr}: ${returnStr};`,
          });
          break;
        }
        case 'array': {
          const serializedType = this.handle(
            className,
            schemas[varient.position],
            true,
            {
              ...context,
              noEmit: true,
              parsable: 'json',
            },
          );
          patterns.push({
            name: `static ${name} ${formatName(varientName)}(${serializedType.use} value) => _Value(value);`,
            pattern: `case ${serializedType.use} json: return ${name}.${formatName(varientName)}(${serializedType.fromJson});`,
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
        ],
      }),
    );

    if (context.noEmit !== true) {
      this.#emit(name, content.join('\n'), {
        oneOf: schemas,
      });
    }

    return {
      content: content.join('\n'),
      use: name,
      encodeV2: `${context.required ? '' : '?'}.toJson()`,
      fromJson: `${name}.fromJson(${context.parsable})`,
      matches: `${name}.matches(${context.parsable})`,
    };
  }

  #simple(type?: SchemaObjectType) {
    switch (type) {
      case 'string':
        return 'String';
      case 'number':
        return 'double';
      case 'integer':
        return 'int';
      case 'boolean':
        return 'bool';
      case 'object':
        return 'Map<String, dynamic>';
      case 'array':
        return 'List<dynamic>';
      case 'null':
        return 'Null';
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

    //   ${this.#buildClass({
    //     name: '_EnumValue',
    //     implements: [pascalcase(formatName(name))],
    //     content: `final ${valType} value;
    // const _EnumValue(this.value);
    // @override
    // toJson() => value;`,
    //   })}
    // formatName(snakecase(formatName(it))) => formatName('NEW') => NEW => snakecase(formatName('NEW')) => new => formatName(snakecase(formatName('NEW'))) => $new
    const content = `
  class _EnumValue implements ${pascalcase(formatName(name))} {
  final ${valType} value;
  const _EnumValue(this.value);
  @override
  toJson() => value;
}
    abstract ${mixins.length ? '' : 'mixin'} class ${pascalcase(formatName(name))} ${withMixins} {
      ${values.map((it) => `static const _EnumValue ${formatName(snakecase(formatName(it)))} = _EnumValue(${typeof it === 'number' ? it : `'${it}'`});`).join('\n')}
      dynamic toJson();

      ${valType} get value;

      static _EnumValue fromJson(${valType} value) {
      switch (value) {
${values
  .map(
    (it) =>
      `case ${typeof it === 'number' ? it : `'${it}'`}: return ${formatName(snakecase(formatName(it)))};`,
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
      this.#emit(pascalcase(formatName(name)), content, schema);
    }
    return {
      use: pascalcase(formatName(name)),
      type: this.#simple(coerceTypes(schema)[0]),
      content: content,
      encodeV2: `${context.required ? '' : '?'}.toJson()`,
      fromJson: `${pascalcase(name)}.fromJson(${context.parsable})`,
      matches: `${pascalcase(name)}.matches(${context.parsable})`,
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
      fromJson: context.parsable,
      matches: context.parsable,
      simple: true,
    };
  }

  /**
   * Handle string type with formats
   */
  #string(schema: SchemaObject, context: Context): Serialized {
    switch (schema.format) {
      case 'date-time':
      case 'datetime':
      case 'date':
        return {
          content: '',
          use: 'DateTime',
          simple: true,
          encodeV2: `${context.required ? '' : '?'}.toIso8601String()`,
          fromJson: context.parsable
            ? context.required
              ? `DateTime.parse(${context.parsable})`
              : `${context.parsable} != null ? DateTime.parse(${context.parsable}) : null`
            : 'json',
          matches: `${context.parsable} is String`,
        };
      case 'binary':
      case 'byte':
        return {
          content: '',
          use: 'File',
          encodeV2: '',
          simple: true,
          fromJson: context.parsable,
          matches: `${context.parsable} is Uint8List`,
        };
      default:
        return {
          encode: 'input',
          use: `String`,
          content: '',
          encodeV2: '',
          simple: true,
          fromJson: `${context.parsable} as String`,
          matches: `${context.parsable} is String`,
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
        fromJson: context.parsable,
        matches: `${context.parsable} is int`,
      };
    }
    if (['float', 'double'].includes(schema.format as string)) {
      return {
        content: '',
        use: 'double',
        simple: true,
        encodeV2: '',
        fromJson: context.parsable,
        matches: `${context.parsable} is double`,
      };
    }
    return {
      content: '',
      use: 'num',
      simple: true,
      encodeV2: '',
      fromJson: context.parsable,
      matches: `${context.parsable} is double`,
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
        fromJson: context.parsable,
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
        pascalcase(formatName(className)),
        `typedef ${pascalcase(alias)} = ${serialized.use};`,
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
  return (
    !isRef(schema) &&
    (schema.type === 'object' || !!coearceObject(schema).properties)
  );
}
