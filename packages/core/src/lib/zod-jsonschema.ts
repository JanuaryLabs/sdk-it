export type InjectImport = {
  import: string;
  from: string;
  property?: string;
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
    // zod 4 removed ZodString.ip/.cidr; restore them for analyzed user source
    // that still uses the v3 spellings.
    `const stringProto = Object.getPrototypeOf(z.string());
    const installedShims = [];
    function withReceiverChecks(receiver, format) {
      return (receiver._zod.def.checks ?? []).length
        ? z.intersection(receiver, format)
        : format;
    }
    if (!stringProto.ip) {
      installedShims.push('ip');
      stringProto.ip = function (options) {
        if (options?.version === 'v4') return withReceiverChecks(this, z.ipv4());
        if (options?.version === 'v6') return withReceiverChecks(this, z.ipv6());
        return withReceiverChecks(this, z.union([z.ipv4(), z.ipv6()]));
      };
    }
    if (!stringProto.cidr) {
      installedShims.push('cidr');
      stringProto.cidr = function (options) {
        if (options?.version === 'v4') return withReceiverChecks(this, z.cidrv4());
        if (options?.version === 'v6') return withReceiverChecks(this, z.cidrv6());
        return withReceiverChecks(this, z.union([z.cidrv4(), z.cidrv6()]));
      };
    }`,
    ...imports.map(
      (imp) =>
        `const ${imp.import} = require(${JSON.stringify(imp.from)})${
          imp.property ? `[${JSON.stringify(imp.property)}]` : ''
        };`,
    ),
    `let optional = false;`,
    `const WRAPPER_TYPES = new Set([
      'optional',
      'nullable',
      'default',
      'prefault',
      'catch',
      'readonly',
      'nonoptional',
    ]);`,
    `function unwrapSchemaDef(def) {
      while (def) {
        if (WRAPPER_TYPES.has(def.type)) {
          def = def.innerType?._zod?.def;
          continue;
        }
        if (def.type === 'pipe') {
          def = def.in?._zod?.def;
          continue;
        }
        return def;
      }
      return def;
    }`,
    `function matchesDefType(schema, defType) {
      if (!schema || typeof schema !== 'object') return false;
      if (defType === 'number') {
        return schema.type === 'number' || schema.type === 'integer';
      }
      if (defType === 'bigint') {
        return schema.type === 'integer';
      }
      if (defType === 'string') {
        return schema.type === 'string';
      }
      if (defType === 'boolean') {
        return schema.type === 'boolean';
      }
      if (defType === 'date') {
        return schema.type === 'string' && schema.format === 'date-time';
      }
      return typeof schema.type === 'string';
    }`,
    `function applyZodType(schema, zodType, defType) {
      if (!schema || typeof schema !== 'object') return false;
      if (schema['x-zod-type']) return true;
      if (matchesDefType(schema, defType)) {
        schema['x-zod-type'] = zodType;
        return true;
      }
      for (const key of ['anyOf', 'oneOf', 'allOf']) {
        if (!Array.isArray(schema[key])) continue;
        const candidates = schema[key].filter(
          (candidate) => candidate && candidate.type !== 'null',
        );
        if (candidates.length === 1 && applyZodType(candidates[0], zodType, defType)) {
          return true;
        }
        for (const candidate of candidates) {
          if (applyZodType(candidate, zodType, defType)) {
            return true;
          }
        }
      }
      return false;
    }`,
    `const BIGINT_SENTINEL = '__sdkit_bigint__';`,
    // zod v4 JSON-round-trips default values before the override callback
    // runs, which throws on bigint. Mask them as sentinel strings up front
    // and restore after conversion.
    `function maskBigIntDefaults(schema, seen = new Set()) {
      if (!schema || !schema._zod || seen.has(schema)) return;
      seen.add(schema);
      const def = schema._zod.def;
      if (
        (def.type === 'default' || def.type === 'prefault') &&
        typeof def.defaultValue === 'bigint'
      ) {
        Object.defineProperty(def, 'defaultValue', {
          value: BIGINT_SENTINEL + def.defaultValue.toString(),
          configurable: true,
        });
      }
      for (const key of ['innerType', 'in', 'out', 'element', 'valueType', 'keyType', 'left', 'right', 'catchall', 'rest']) {
        if (def[key]) maskBigIntDefaults(def[key], seen);
      }
      if (typeof def.getter === 'function') {
        const inner = def.getter();
        maskBigIntDefaults(inner, seen);
        Object.defineProperty(def, 'getter', {
          value: () => inner,
          configurable: true,
        });
      }
      if (def.shape) {
        for (const value of Object.values(def.shape)) maskBigIntDefaults(value, seen);
      }
      if (Array.isArray(def.options)) {
        for (const option of def.options) maskBigIntDefaults(option, seen);
      }
      if (Array.isArray(def.items)) {
        for (const item of def.items) maskBigIntDefaults(item, seen);
      }
    }`,
    // int64 is a plain number in sdk-it, so masked bigint defaults unmask to
    // JS numbers — the spec stays plain JSON with no bigint values to trip up
    // JSON.stringify.
    `function unmaskBigIntDefaults(schema) {
      if (!schema || typeof schema !== 'object') return;
      for (const [key, value] of Object.entries(schema)) {
        if (typeof value === 'string' && value.startsWith(BIGINT_SENTINEL)) {
          schema[key] = Number(value.slice(BIGINT_SENTINEL.length));
        } else if (Array.isArray(value)) {
          value.forEach(unmaskBigIntDefaults);
        } else if (value && typeof value === 'object') {
          unmaskBigIntDefaults(value);
        }
      }
    }`,
    `function hasExplicitRegexCheck(def) {
      return (def.checks ?? []).some(
        (check) => check._zod?.def?.format === 'regex',
      );
    }`,
    `const STANDARD_STRING_FORMATS = new Set([
      'email',
      'uri',
      'url',
      'uuid',
      'guid',
      'date-time',
      'date',
      'time',
      'duration',
      'ipv4',
      'ipv6',
      'hostname',
      'binary',
    ]);`,
    // Nonstandard formats that sdk-it's own converters map to semantic zod
    // validators. Keep both keys: format for our converters, pattern for
    // third-party validators that do not recognize the format.
    `const MAPPED_NONSTANDARD_FORMATS = new Set(['cidrv4', 'cidrv6']);`,
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
        if (
          schema &&
          typeof schema === 'object' &&
          Object.keys(schema).length === 0
        ) {
          continue;
        }
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
    `function normalizeSchema(schema, isIntersectionMember = false) {
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
        schema[key] = schema[key].map((candidate) =>
          normalizeSchema(candidate, key === 'allOf'),
        );
      }

      if (Array.isArray(schema.oneOf) && !schema.anyOf) {
        schema.anyOf = schema.oneOf;
        delete schema.oneOf;
      }

      if (
        Array.isArray(schema.anyOf) &&
        schema.anyOf.every(
          (member) =>
            member &&
            typeof member === 'object' &&
            Object.keys(member).length === 1 &&
            typeof member.type === 'string',
        )
      ) {
        const { anyOf, ...rest } = schema;
        schema = { ...rest, type: anyOf.map((member) => member.type) };
      }

      if (
        schema.type === 'object' &&
        schema.properties &&
        schema.additionalProperties === undefined &&
        !isIntersectionMember
      ) {
        schema.additionalProperties = false;
      }

      if (
        schema.type === 'object' &&
        schema.propertyNames &&
        JSON.stringify(schema.propertyNames) === '{"type":"string"}'
      ) {
        delete schema.propertyNames;
      }

      if (
        typeof schema.$ref === 'string' &&
        !schema.$ref.startsWith('#/components/schemas')
      ) {
        schema.$ref =
          schema.$ref === '#'
            ? '#/components/schemas'
            : schema.$ref.replace(/^#\\//, '#/components/schemas/');
      }

      if (Array.isArray(schema.allOf)) {
        const merged = mergePrimitiveSchemas(schema.allOf);
        if (merged) {
          const { allOf, ...rest } = schema;
          return { ...rest, ...merged };
        }
        if (schema.allOf.length === 1 && Object.keys(schema).length === 1) {
          return schema.allOf[0];
        }
      }

      return schema;
    }`,
    `function escapePointerSegment(segment) {
      return String(segment).replaceAll('~', '~0').replaceAll('/', '~1');
    }`,
    `function componentPointer(path) {
      return ['#', 'components', 'schemas', ...path.map(escapePointerSegment)].join('/');
    }`,
    // Nested toJsonSchema passes (set/map values, pipe outputs) return
    // self-contained draft-7 documents whose '#' and '#/definitions/*' refs
    // are relative to the embedded document root, not the outer schema.
    // Resolve them to outer-root structural pointers before the outer
    // definitions/normalize passes rewrite them into dangling refs.
    `function resolveEmbeddedDocs(root) {
      function process(node, path, docRoot) {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) {
          node.forEach((item, index) => process(item, [...path, index], docRoot));
          return;
        }
        if (node['x-sdkit-embedded-root']) {
          delete node['x-sdkit-embedded-root'];
          const defs = node.definitions ?? Object.create(null);
          delete node.definitions;
          docRoot = { path, defs, firstSite: Object.create(null) };
        }
        if (docRoot && typeof node.$ref === 'string') {
          if (node.$ref === '#') {
            node.$ref = componentPointer(docRoot.path);
            return;
          }
          const match = node.$ref.match(/^#\\/definitions\\/(.+)$/);
          if (match) {
            const name = match[1];
            if (name in docRoot.firstSite) {
              node.$ref = docRoot.firstSite[name];
              return;
            }
            docRoot.firstSite[name] = componentPointer(path);
            delete node.$ref;
            Object.assign(node, docRoot.defs[name]);
          }
        }
        for (const [key, value] of Object.entries(node)) {
          process(value, [...path, key], docRoot);
        }
      }
      process(root, [], null);
      return root;
    }`,
    // zod v4 breaks non-root cycles with a draft-7 definitions block plus
    // #/definitions/* refs, which OpenAPI consumers cannot resolve. Inline
    // each definition at its first use site and point the remaining
    // (recursive) refs structurally at that site, mirroring the v3
    // $refStrategy: 'root' output.
    `function inlineDefinitions(root) {
      const defs = root.definitions;
      if (!defs || typeof defs !== 'object') return root;
      delete root.definitions;
      const firstSite = Object.create(null);
      function walk(node, path) {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) {
          node.forEach((item, index) => walk(item, [...path, index]));
          return;
        }
        const match =
          typeof node.$ref === 'string' &&
          node.$ref.match(/^#\\/definitions\\/(.+)$/);
        if (match) {
          const name = match[1];
          if (name in firstSite) {
            node.$ref = firstSite[name];
            return;
          }
          firstSite[name] = componentPointer(path);
          delete node.$ref;
          Object.assign(node, defs[name]);
        }
        for (const [key, value] of Object.entries(node)) {
          walk(value, [...path, key]);
        }
      }
      walk(root, []);
      return root;
    }`,
    // Wraps nested conversions: when the embedded document carries refs or a
    // definitions block, tag its root so resolveEmbeddedDocs can rebase them.
    `function convertEmbedded(schema) {
      const { $schema: _ignored, ...doc } = toJsonSchema(schema);
      if (doc.definitions || JSON.stringify(doc).includes('"$ref"')) {
        doc['x-sdkit-embedded-root'] = true;
      }
      return doc;
    }`,
    `function toJsonSchema(schema) {
      return z.toJSONSchema(schema, {
        target: 'draft-7',
        io: 'input',
        unrepresentable: 'any',
        override(ctx) {
          const def = ctx.zodSchema._zod.def;
          const json = ctx.jsonSchema;
          if (def.type === 'optional') {
            optional = true;
          }
          if (def.type === 'catch') {
            delete json.default;
          }
          if (def.type === 'date') {
            json.type = 'string';
            json.format = 'date-time';
            json['x-zod-type'] = def.coerce ? 'coerce-date' : 'date';
          }
          if (def.type === 'bigint') {
            json.type = 'integer';
            // z.bigint() carries no format; treat it as int64.
            json.format = ctx.zodSchema._zod.bag.format ?? 'int64';
            if (def.coerce) {
              json['x-zod-type'] = 'coerce-bigint';
            }
          }
          if (def.type === 'set') {
            json.type = 'array';
            json.uniqueItems = true;
            json.items = convertEmbedded(def.valueType);
          }
          if (def.type === 'map') {
            json.type = 'array';
            json.items = {
              type: 'array',
              items: [convertEmbedded(def.keyType), convertEmbedded(def.valueType)],
              minItems: 2,
              maxItems: 2,
            };
          }
          if (def.type === 'string' && json.format === 'base64') {
            json.format = 'binary';
            delete json.pattern;
            delete json.contentEncoding;
          }
          if (
            def.type === 'string' &&
            json.format &&
            json.pattern &&
            !hasExplicitRegexCheck(def)
          ) {
            if (STANDARD_STRING_FORMATS.has(json.format)) {
              delete json.pattern;
            } else if (!MAPPED_NONSTANDARD_FORMATS.has(json.format)) {
              delete json.format;
            }
          }
          if (def.type === 'number') {
            const explicitBound = (kind, value) =>
              (def.checks ?? []).some(
                (check) =>
                  check._zod?.def?.check === kind &&
                  Number(check._zod.def.value) === value,
              );
            if (
              json.maximum === Number.MAX_SAFE_INTEGER &&
              !explicitBound('less_than', Number.MAX_SAFE_INTEGER)
            ) {
              delete json.maximum;
            }
            if (
              json.minimum === Number.MIN_SAFE_INTEGER &&
              !explicitBound('greater_than', Number.MIN_SAFE_INTEGER)
            ) {
              delete json.minimum;
            }
          }
          if (def.type === 'pipe') {
            const outJson = convertEmbedded(def.out);
            const outKeys = Object.keys(outJson).filter(
              (key) => key !== 'x-sdkit-embedded-root',
            );
            if (outKeys.length > 0) {
              const inJson = { ...json };
              for (const key of Object.keys(json)) delete json[key];
              json.allOf = [inJson, outJson];
            }
          }
          if (def.type === 'tuple' && Array.isArray(json.items)) {
            if (json.minItems === undefined) {
              json.minItems = json.items.length;
            }
            if (
              json.additionalItems === undefined &&
              json.maxItems === undefined
            ) {
              json.maxItems = json.items.length;
            }
          }
        },
      });
    }`,
    `let zodSchema;
    let rawResult;
    try {
      zodSchema = ${removeUnsupportedMethods(schema)};
      maskBigIntDefaults(zodSchema);
      const { $schema, ...converted } = toJsonSchema(zodSchema);
      rawResult = converted;
    } finally {
      // The v3 shims exist only while the analyzed source evaluates and
      // converts (lazy getters can call them mid-conversion); remove them so
      // the shared zod instance is not left with v3 API surface process-wide.
      for (const method of installedShims) delete stringProto[method];
    }
    unmaskBigIntDefaults(rawResult);
    const result = normalizeSchema(
      inlineDefinitions(resolveEmbeddedDocs(rawResult)),
    );`,
    `const innerDef = unwrapSchemaDef(zodSchema._zod.def);
    if (innerDef?.coerce && !result['x-zod-type']) {
      const zodType = 'coerce-' + innerDef.type;
      if (!applyZodType(result, zodType, innerDef.type)) {
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
