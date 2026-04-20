export type InjectImport = {
  import: string;
  from: string;
};

function removeUnsupportedMethods(schema: string) {
  return schema
    .replaceAll('.instanceof(File)', '.string().base64()')
    .replaceAll('.instanceof(Blob)', '.string().base64()')
    .replaceAll('.custom<File>()', '.string().base64()')
    .replaceAll('.custom<Blob>()', '.string().base64()');
}

export async function evalZod(schema: string, imports: InjectImport[] = []) {
  // https://github.com/nodejs/node/issues/51956
  const lines = [
    `import { createRequire } from "node:module";`,
    `const filename = "${import.meta.url}";`,
    `const require = createRequire(filename);`,
    `const z = require("zod");`,
    ...imports.map((imp) => `const ${imp.import} = require('${imp.from}');`),
    `const {zodToJsonSchema, ignoreOverride} = require('zod-to-json-schema');`,
    `let optional = false;`,
    `function unwrapSchemaDef(def) {
      while (def) {
        if (
          def.typeName === 'ZodOptional' ||
          def.typeName === 'ZodDefault' ||
          def.typeName === 'ZodNullable' ||
          def.typeName === 'ZodCatch' ||
          def.typeName === 'ZodBranded' ||
          def.typeName === 'ZodReadonly'
        ) {
          def = def.innerType?._def;
          continue;
        }
        if (def.typeName === 'ZodEffects') {
          def = def.schema?._def;
          continue;
        }
        if (def.typeName === 'ZodPipeline') {
          def = def.in?._def;
          continue;
        }
        return def;
      }
      return def;
    }`,
    `function matchesDefType(schema, typeName) {
      if (!schema || typeof schema !== 'object') return false;
      if (typeName === 'ZodNumber') {
        return schema.type === 'number' || schema.type === 'integer';
      }
      if (typeName === 'ZodBigInt') {
        return schema.type === 'integer';
      }
      if (typeName === 'ZodString') {
        return schema.type === 'string';
      }
      if (typeName === 'ZodBoolean') {
        return schema.type === 'boolean';
      }
      if (typeName === 'ZodDate') {
        return schema.type === 'string' && schema.format === 'date-time';
      }
      return typeof schema.type === 'string';
    }`,
    `function applyZodType(schema, zodType, typeName) {
      if (!schema || typeof schema !== 'object') return false;
      if (schema['x-zod-type']) return true;
      if (matchesDefType(schema, typeName)) {
        schema['x-zod-type'] = zodType;
        return true;
      }
      for (const key of ['anyOf', 'oneOf', 'allOf']) {
        if (!Array.isArray(schema[key])) continue;
        const candidates = schema[key].filter(
          (candidate) => candidate && candidate.type !== 'null',
        );
        if (candidates.length === 1 && applyZodType(candidates[0], zodType, typeName)) {
          return true;
        }
        for (const candidate of candidates) {
          if (applyZodType(candidate, zodType, typeName)) {
            return true;
          }
        }
      }
      return false;
    }`,
    `function normalizeDefaultValue(value) {
      return value instanceof Date ? value.toISOString() : value;
    }`,
    `function mergeComparableValue(target, key, value) {
      if (value === undefined) return true;
      const normalized = normalizeDefaultValue(value);
      if (target[key] === undefined) {
        target[key] = normalized;
        return true;
      }
      return Object.is(target[key], normalized);
    }`,
    `function mergeLowerBound(target, key, value) {
      if (value === undefined) return true;
      if (typeof value !== 'number') return false;
      if (target[key] === undefined || value > target[key]) {
        target[key] = value;
      }
      return true;
    }`,
    `function mergeUpperBound(target, key, value) {
      if (value === undefined) return true;
      if (typeof value !== 'number') return false;
      if (target[key] === undefined || value < target[key]) {
        target[key] = value;
      }
      return true;
    }`,
    `function mergeEnumValues(target, values) {
      if (!Array.isArray(values)) return false;
      if (!Array.isArray(target.enum)) {
        target.enum = [...values];
        return true;
      }
      target.enum = target.enum.filter((candidate) =>
        values.some((value) => Object.is(candidate, value)),
      );
      return target.enum.length > 0;
    }`,
    `function isMergeablePrimitiveSchema(schema) {
      return (
        schema &&
        typeof schema === 'object' &&
        !schema.$ref &&
        !schema.anyOf &&
        !schema.oneOf &&
        !schema.allOf &&
        (schema.type === 'string' ||
          schema.type === 'boolean' ||
          schema.type === 'number' ||
          schema.type === 'integer')
      );
    }`,
    `function mergePrimitiveSchemas(schemas) {
      const merged = {};
      for (const schema of schemas) {
        if (!isMergeablePrimitiveSchema(schema)) {
          return null;
        }
        if (merged.type === undefined) {
          merged.type = schema.type;
        } else if (merged.type !== schema.type) {
          const numericPair =
            (merged.type === 'number' && schema.type === 'integer') ||
            (merged.type === 'integer' && schema.type === 'number');
          if (!numericPair) {
            return null;
          }
          merged.type = 'integer';
        }

        for (const [key, value] of Object.entries(schema)) {
          if (key === 'type') {
            continue;
          }
          switch (key) {
            case 'minimum':
            case 'exclusiveMinimum':
            case 'minLength':
            case 'minItems':
            case 'minProperties':
              if (!mergeLowerBound(merged, key, value)) {
                return null;
              }
              break;
            case 'maximum':
            case 'exclusiveMaximum':
            case 'maxLength':
            case 'maxItems':
            case 'maxProperties':
              if (!mergeUpperBound(merged, key, value)) {
                return null;
              }
              break;
            case 'enum':
              if (!mergeEnumValues(merged, value)) {
                return null;
              }
              break;
            default:
              if (!mergeComparableValue(merged, key, value)) {
                return null;
              }
          }
        }
      }
      return merged;
    }`,
    `function normalizeSchema(schema) {
      if (!schema || typeof schema !== 'object') {
        return schema;
      }

      if (schema.default !== undefined) {
        schema.default = normalizeDefaultValue(schema.default);
      }

      if (Array.isArray(schema.items)) {
        schema.items = schema.items.map((item) => normalizeSchema(item));
      } else if (schema.items && typeof schema.items === 'object') {
        schema.items = normalizeSchema(schema.items);
      }

      if (schema.properties && typeof schema.properties === 'object') {
        for (const [key, value] of Object.entries(schema.properties)) {
          schema.properties[key] = normalizeSchema(value);
        }
      }

      if (
        schema.additionalProperties &&
        typeof schema.additionalProperties === 'object'
      ) {
        schema.additionalProperties = normalizeSchema(schema.additionalProperties);
      }

      for (const key of ['anyOf', 'oneOf', 'allOf']) {
        if (!Array.isArray(schema[key])) continue;
        schema[key] = schema[key].map((candidate) => normalizeSchema(candidate));
      }

      if (Array.isArray(schema.allOf)) {
        const merged = mergePrimitiveSchemas(schema.allOf);
        if (merged) {
          const { allOf, ...rest } = schema;
          return { ...rest, ...merged };
        }
      }

      return schema;
    }`,
    `function toJsonSchema(schema) {
      return zodToJsonSchema(schema, {
        $refStrategy: 'root',
        basePath: ['#', 'components', 'schemas'],
        target: 'jsonSchema7',
        base64Strategy: 'format:binary',
        effectStrategy: 'input',
        override: (def) => {
          if (def.typeName === 'ZodOptional') {
						optional = true;
						const { $schema, ...result } = toJsonSchema(def.innerType);
            if (def.description) { result.description = def.description; }
            return result;
          }
          if (def.typeName === 'ZodDate') {
            return {
              type: 'string',
              format: 'date-time',
              'x-zod-type': def.coerce ? 'coerce-date' : 'date',
              ...(def.description ? { description: def.description } : {}),
            };
          }
          return ignoreOverride;
        },
      });
    }`,
    `const zodSchema = ${removeUnsupportedMethods(schema)};`,
    `const { $schema, ...rawResult } = toJsonSchema(zodSchema);
    const result = normalizeSchema(rawResult);`,
    `const innerDef = unwrapSchemaDef(zodSchema._def);
    if (innerDef?.coerce && !result['x-zod-type']) {
      const zodType = 'coerce-' + innerDef.typeName.replace('Zod', '').toLowerCase();
      if (!applyZodType(result, zodType, innerDef.typeName)) {
        result['x-zod-type'] = zodType;
      }
    }`,
    `export default {schema: result, optional}`,
  ];

  const base64 = Buffer.from(lines.join('\n')).toString('base64');
  return import(
    /* @vite-ignore */
    `data:text/javascript;base64,${base64}`
  ).then((mod) => mod.default);
}
