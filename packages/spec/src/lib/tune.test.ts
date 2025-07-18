import { merge } from 'lodash-es';
import { describe, it } from 'node:test';
import type { OpenAPIObject, SchemaObject } from 'openapi3-ts/oas31';

import { toIR } from './ir.ts';
import type { IR } from './types.ts';

function createSpec(openapi?: Partial<OpenAPIObject>): IR {
  return toIR(
    {
      spec: merge(
        {
          openapi: '3.1.0',
          info: {
            title: 'Test API',
            version: '1.0.0',
          },
          components: {
            schemas: {},
            securitySchemes: {},
          },
          paths: {},
        },
        openapi,
      ),
    },
    true,
  );
}

describe('merge allof', () => {
  // it('should merge allOf schemas', () => {
  //   const spec = createSpec({
  //     components: {
  //       schemas: {
  //         Base: {
  //           type: 'object',
  //           properties: {
  //             id: { type: 'string' },
  //           },
  //         },
  //         Extended: {
  //           allOf: [
  //             { $ref: '#/components/schemas/Base' },
  //             {
  //               type: 'object',
  //               properties: {
  //                 name: { type: 'string' },
  //               },
  //             },
  //           ],
  //         },
  //       },
  //     },
  //   });

  //   const extendedSchema = spec.components.schemas.Extended as SchemaObject;
  //   console.log(extendedSchema);
  //   assert.deepStrictEqual(extendedSchema.type, 'object');
  //   assert.deepStrictEqual(extendedSchema.properties, {
  //     id: { type: 'string' },
  //     name: { type: 'string' },
  //   });
  // });
  // it('should handle empty allOf', () => {
  //   const spec = createSpec({
  //     components: {
  //       schemas: {
  //         EmptyAllOf: {
  //           allOf: [],
  //         },
  //       },
  //     },
  //   });

  //   const emptySchema = spec.components.schemas.EmptyAllOf as SchemaObject;
  //   assert.deepStrictEqual(emptySchema.allOf, undefined);
  //   assert.deepStrictEqual(emptySchema.type, undefined);
  // });
  // it('should handle allOf with only references', () => {
  //   const spec = createSpec({
  //     components: {
  //       schemas: {
  //         Base: {
  //           type: 'object',
  //           properties: {
  //             id: { type: 'string' },
  //           },
  //         },
  //         Extended: {
  //           allOf: [
  //             {
  //               $ref: '#/components/schemas/Base',
  //             },
  //           ],
  //         },
  //       },
  //     },
  //   });

  //   const extendedSchema = spec.components.schemas.Extended as SchemaObject;
  //   assert.deepStrictEqual(extendedSchema.type, 'object');
  //   assert.deepStrictEqual(extendedSchema.properties, {
  //     id: {
  //       type: 'string',
  //     },
  //   });
  // });

  it('should handle circular allOf references without stack overflow', () => {
    const spec = createSpec({
      components: {
        schemas: {
          A: {
            allOf: [
              { $ref: '#/components/schemas/B' },
              {
                type: 'object',
                properties: {
                  nameA: { type: 'string' },
                },
              },
            ],
          },
          B: {
            allOf: [
              { $ref: '#/components/schemas/A' },
              {
                type: 'object',
                properties: {
                  nameB: { type: 'string' },
                },
              },
            ],
          },
        },
      },
    });

    // This would cause a stack overflow with the current implementation
    const schemaA = spec.components.schemas.A as SchemaObject;
    console.dir(spec.components.schemas, { depth: null });
    // The test should not throw RangeError: Maximum call stack size exceeded
  });

  // it('should handle circular allOf references without stack overflow', () => {
  //   const spec = createSpec({
  //     components: {
  //       schemas: {
  //         A: {
  //           allOf: [
  //             { $ref: '#/components/schemas/B' },
  //             {
  //               type: 'object',
  //               properties: {
  //                 nameA: { type: 'string' },
  //               },
  //             },
  //           ],
  //         },
  //         B: {
  //           allOf: [
  //             { $ref: '#/components/schemas/A' },
  //             {
  //               type: 'object',
  //               properties: {
  //                 nameB: { type: 'string' },
  //               },
  //             },
  //           ],
  //         },
  //       },
  //     },
  //   });

  //   // This would cause a stack overflow with the current implementation
  //   const schemaA = spec.components.schemas.A as SchemaObject;
  //   console.dir(spec.components.schemas, { depth: null });
  //   // The test should not throw RangeError: Maximum call stack size exceeded
  // });

  // it('should handle self-referencing allOf', () => {
  //   const spec = createSpec({
  //     components: {
  //       schemas: {
  //         SelfRef: {
  //           allOf: [
  //             { $ref: '#/components/schemas/SelfRef' },
  //             {
  //               type: 'object',
  //               properties: {
  //                 name: { type: 'string' },
  //               },
  //             },
  //           ],
  //         },
  //       },
  //     },
  //   });

  //   // This would also cause infinite recursion
  //   const schema = spec.components.schemas.SelfRef as SchemaObject;
  // });
});
