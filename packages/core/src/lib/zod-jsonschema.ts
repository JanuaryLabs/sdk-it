export type InjectImport = {
  import: string;
  from: string;
};

function removeUnsupportedMethods(schema: string) {
	// fixme: use overrides to detect instanceOf
  return schema.replaceAll('.instanceof(File)', '.string().base64()');
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
            return result;
          }
          if (def.typeName === 'ZodDate') {
            return {
              type: 'string',
              format: 'date-time',
              'x-zod-type': def.coerce ? 'coerce-date' : 'date',
            };
          }
          return ignoreOverride;
        },
      });
    }`,
    `const zodSchema = ${removeUnsupportedMethods(schema)};`,
    `const { $schema, ...result } = toJsonSchema(zodSchema);`,
    `let innerDef = zodSchema._def;
    while (innerDef && (innerDef.typeName === 'ZodOptional' || innerDef.typeName === 'ZodDefault' || innerDef.typeName === 'ZodNullable')) {
      innerDef = innerDef.innerType?._def;
    }
    if (innerDef?.coerce && !result['x-zod-type']) {
      result['x-zod-type'] = 'coerce-' + innerDef.typeName.replace('Zod', '').toLowerCase();
    }`,
    `export default {schema: result, optional}`,
  ];

  const base64 = Buffer.from(lines.join('\n')).toString('base64');
  return import(
    /* @vite-ignore */
    `data:text/javascript;base64,${base64}`
  ).then((mod) => mod.default);
}
