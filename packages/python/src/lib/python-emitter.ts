import type { ReferenceObject, SchemaObject } from 'openapi3-ts/oas31';
import { snakecase } from 'stringcase';

import { isRef, notRef, parseRef, pascalcase } from '@sdk-it/core';
import { type OurOpenAPIObject, isPrimitiveSchema } from '@sdk-it/spec';

export function coerceObject(schema: SchemaObject): SchemaObject {
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
 * Convert an OpenAPI (JSON Schema style) object into Python classes with Pydantic
 */
export class PythonEmitter {
  #spec: OurOpenAPIObject;
  #emitHandler?: Emit;
  #emitHistory = new Set<string>();
  #typeCache = new Map<string, Serialized>(); // Cache for resolved types

  #emit(name: string, content: string, schema: SchemaObject): void {
    if (this.#emitHistory.has(content)) {
      return;
    }
    this.#emitHistory.add(content);
    this.#emitHandler?.(name, content, schema);
  }

  constructor(spec: OurOpenAPIObject) {
    this.#spec = spec;
  }

  onEmit(emit: Emit): void {
    this.#emitHandler = emit;
  }

  #formatFieldName(name: string): string {
    // Convert to snake_case and handle special cases
    let fieldName = snakecase(name);

    // Handle reserved keywords
    const reservedKeywords = [
      'class',
      'def',
      'if',
      'else',
      'elif',
      'while',
      'for',
      'try',
      'except',
      'finally',
      'with',
      'as',
      'import',
      'from',
      'global',
      'nonlocal',
      'lambda',
      'yield',
      'return',
      'pass',
      'break',
      'continue',
      'True',
      'False',
      'None',
      'and',
      'or',
      'not',
      'in',
      'is',
    ];

    if (reservedKeywords.includes(fieldName)) {
      fieldName = `${fieldName}_`;
    }

    return fieldName;
  }

  #ref(ref: ReferenceObject): Serialized {
    const cacheKey = ref.$ref;
    if (this.#typeCache.has(cacheKey)) {
      return this.#typeCache.get(cacheKey)!;
    }

    const refInfo = parseRef(ref.$ref);
    const refName = refInfo.model;
    const className = pascalcase(refName);

    const result: Serialized = {
      type: className,
      content: '',
      use: className,
      fromJson: `${className}.parse_obj`,
      simple: false,
    };

    this.#typeCache.set(cacheKey, result);
    return result;
  }

  #oneOf(
    variants: (SchemaObject | ReferenceObject)[],
    context: Context,
  ): Serialized {
    const variantTypes = variants
      .map((variant) => this.handle(variant, context))
      .map((result) => result.type || 'Any')
      .filter((type, index, arr) => arr.indexOf(type) === index); // Remove duplicates

    if (variantTypes.length === 0) {
      return {
        type: 'Any',
        content: '',
        use: 'Any',
        fromJson: 'Any',
        simple: true,
      };
    }

    if (variantTypes.length === 1) {
      return {
        type: variantTypes[0],
        content: '',
        use: variantTypes[0],
        fromJson: variantTypes[0],
        simple: true,
      };
    }

    const unionType = `Union[${variantTypes.join(', ')}]`;
    return {
      type: unionType,
      content: '',
      use: unionType,
      fromJson: unionType,
      simple: true,
    };
  }

  #object(
    className: string,
    schema: SchemaObject,
    context: Context,
  ): Serialized {
    const { properties = {}, required = [] } = coerceObject(schema);

    const fields: string[] = [];

    // Handle allOf inheritance
    let baseClass = 'BaseModel';
    if (schema.allOf) {
      const bases = schema.allOf
        .filter(notRef)
        .map((s) => this.handle(s, context))
        .filter((result) => result.type)
        .map((result) => result.type);

      if (bases.length > 0 && bases[0]) {
        baseClass = bases[0];
      }
    }

    // Process properties
    for (const [propName, propSchema] of Object.entries(properties)) {
      if (isRef(propSchema)) {
        const refResult = this.#ref(propSchema);
        const refInfo = parseRef(propSchema.$ref);
        const refName = refInfo.model;
        const pythonType = pascalcase(refName);

        const fieldName = this.#formatFieldName(propName);
        const isRequired = required.includes(propName);
        const fieldType = isRequired ? pythonType : `Optional[${pythonType}]`;
        const defaultValue = isRequired ? '' : ' = None';

        fields.push(`    ${fieldName}: ${fieldType}${defaultValue}`);
      } else {
        const result = this.handle(propSchema, { ...context, name: propName });
        const fieldName = this.#formatFieldName(propName);
        const isRequired = required.includes(propName);

        let fieldType = result.type || 'Any';
        if (!isRequired) {
          fieldType = `Optional[${fieldType}]`;
        }

        const defaultValue = isRequired ? '' : ' = None';
        let fieldDef = `    ${fieldName}: ${fieldType}${defaultValue}`;

        // Add Field() for alias or validation if needed
        if (fieldName !== propName) {
          fieldDef = `    ${fieldName}: ${fieldType} = Field(alias='${propName}'${defaultValue ? ', default=None' : ''})`;
        }

        // Add description as comment if available
        if (propSchema.description) {
          fieldDef += `  # ${propSchema.description}`;
        }

        fields.push(fieldDef);
      }
    }

    // Handle oneOf/anyOf as Union types using centralized logic
    if (schema.oneOf || schema.anyOf) {
      const unionResult = this.#oneOf(
        schema.oneOf || schema.anyOf || [],
        context,
      );
      fields.push(`    value: ${unionResult.type}`);
    }

    // Handle additionalProperties
    if (
      schema.additionalProperties &&
      typeof schema.additionalProperties === 'object'
    ) {
      const addlResult = this.handle(schema.additionalProperties, context);
      fields.push(
        `    additional_properties: Optional[Dict[str, ${addlResult.type || 'Any'}]] = None`,
      );
    }

    // Generate class docstring
    const docstring = schema.description
      ? `    \"\"\"${schema.description}\"\"\"\n`
      : '';

    // Generate to_request_config method for input models
    let requestConfigMethod = '';
    if (schema['x-inputname']) {
      requestConfigMethod = `
    def to_request_config(self, config: RequestConfig) -> RequestConfig:
        \"\"\"Convert this input model to request configuration.\"\"\"
        # Handle path parameters
        path_params = {}
        for key, value in self.dict(exclude_none=True).items():
            if key in config.url:
                path_params[key] = str(value)
                config.url = config.url.replace(f'{{{key}}}', str(value))

        # Handle query parameters
        query_params = {k: v for k, v in self.dict(exclude_none=True).items()
                       if k not in path_params}
        if query_params:
            config.params = query_params

        return config
`;
    }

    const content = `class ${className}(${baseClass}):
${docstring}${fields.length > 0 ? fields.join('\n') : '    pass'}${requestConfigMethod}
`;

    this.#emit(className, content, schema);

    return {
      type: className,
      content,
      use: className,
      fromJson: `${className}.parse_obj`,
      simple: false,
    };
  }

  #primitive(schema: SchemaObject, context: Context): Serialized {
    const { type, format } = schema;
    const nullable = (schema as any).nullable; // Handle nullable as it may not be in the type definition

    let pythonType = 'Any';

    switch (type) {
      case 'string':
        if (format === 'date-time') {
          pythonType = 'datetime';
        } else if (format === 'date') {
          pythonType = 'date';
        } else if (format === 'uuid') {
          pythonType = 'UUID';
        } else if (format === 'binary' || format === 'byte') {
          pythonType = 'bytes';
        } else {
          pythonType = 'str';
        }
        break;

      case 'integer':
        if (format === 'int64') {
          pythonType = 'int'; // Python 3 ints are arbitrary precision
        } else {
          pythonType = 'int';
        }
        break;

      case 'number':
        pythonType = 'float';
        break;

      case 'boolean':
        pythonType = 'bool';
        break;

      default:
        pythonType = 'Any';
    }

    if (nullable) {
      pythonType = `Optional[${pythonType}]`;
    }

    return {
      type: pythonType,
      content: '',
      use: pythonType,
      fromJson: pythonType,
      simple: true,
      nullable,
    };
  }

  #array(schema: SchemaObject, context: Context): Serialized {
    const itemsSchema = schema.items;
    if (!itemsSchema) {
      return {
        type: 'List[Any]',
        content: '',
        use: 'List[Any]',
        fromJson: 'list',
        simple: true,
      };
    }

    const itemsResult = this.handle(itemsSchema, context);
    const listType = `List[${itemsResult.type || 'Any'}]`;

    return {
      type: listType,
      content: itemsResult.content,
      use: listType,
      fromJson: `List[${itemsResult.fromJson || itemsResult.type}]`,
      simple: true,
    };
  }

  #enum(schema: SchemaObject, context: Context): Serialized {
    const { enum: enumValues } = schema;
    if (!enumValues || enumValues.length === 0) {
      return this.#primitive(schema, context);
    }

    if (!context.name) {
      throw new Error('Enum schemas must have a name in context');
    }

    const className = pascalcase(context.name);

    const enumItems = enumValues.map((value, index) => {
      const name =
        typeof value === 'string'
          ? value.toUpperCase().replace(/[^A-Z0-9]/g, '_')
          : `VALUE_${index}`;

      const pythonValue =
        typeof value === 'string' ? `'${value}'` : String(value);
      return `    ${name} = ${pythonValue}`;
    });

    const content = `class ${className}(Enum):
    \"\"\"Enumeration for ${context.name}.\"\"\"
${enumItems.join('\n')}
`;

    this.#emit(className, content, schema);

    return {
      type: className,
      content,
      use: className,
      fromJson: className,
      simple: false,
    };
  }

  #const(schema: SchemaObject, context: Context): Serialized {
    const { const: constValue } = schema;

    if (typeof constValue === 'string') {
      return {
        type: `Literal['${constValue}']`,
        content: '',
        use: `Literal['${constValue}']`,
        fromJson: `'${constValue}'`,
        simple: true,
        literal: constValue,
      };
    }

    return {
      type: `Literal[${JSON.stringify(constValue)}]`,
      content: '',
      use: `Literal[${JSON.stringify(constValue)}]`,
      fromJson: JSON.stringify(constValue),
      simple: true,
      literal: constValue,
    };
  }
  handle(
    schema: SchemaObject | ReferenceObject,
    context: Context = {},
  ): Serialized {
    if (isRef(schema)) {
      return this.#ref(schema);
    }

    // Handle const values
    if ('const' in schema && schema.const !== undefined) {
      return this.#const(schema, context);
    }

    // Handle enums
    if (schema.enum) {
      return this.#enum(schema, context);
    }

    // Handle arrays
    if (schema.type === 'array') {
      return this.#array(schema, context);
    }

    // Handle oneOf/anyOf at top level using centralized logic
    if (schema.oneOf || schema.anyOf) {
      return this.#oneOf(schema.oneOf || schema.anyOf || [], context);
    }

    // Handle objects
    if (
      schema.type === 'object' ||
      schema.properties ||
      schema.allOf ||
      schema.oneOf ||
      schema.anyOf
    ) {
      if (!context.name) {
        throw new Error('Object schemas must have a name in context');
      }
      const className = pascalcase(context.name);
      return this.#object(className, schema, context);
    }

    // Handle primitives
    if (isPrimitiveSchema(schema)) {
      return this.#primitive(schema, context);
    }

    // Fallback to Any
    return {
      type: 'Any',
      content: '',
      use: 'Any',
      fromJson: 'Any',
      simple: true,
    };
  }
}
