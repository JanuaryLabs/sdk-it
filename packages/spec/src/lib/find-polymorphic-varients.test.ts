import { merge } from 'lodash-es';
import assert from 'node:assert';
import { describe, it } from 'node:test';
import type { OpenAPIObject, SchemaObject } from 'openapi3-ts/oas31';

import {
  type Varient,
  findPolymorphicVarients,
  findVarients,
} from './find-polymorphic-varients.ts';
import { augmentSpec } from './operation.ts';
import type { OurOpenAPIObject } from './types.ts';

function createSpec(openapi?: Partial<OpenAPIObject>): OurOpenAPIObject {
  return augmentSpec(
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
describe('findVarients', () => {
  describe('strings', () => {
    it('names string type as text', () => {
      const spec = createSpec();
      const result = findVarients(spec, [{ type: 'string' }]);

      assert.deepStrictEqual(result, [
        {
          name: 'text',
          position: 0,
          type: 'string',
        },
      ] satisfies Varient[]);
    });
    it('names string based on format', () => {
      const spec = createSpec();
      const result = findVarients(spec, [
        {
          type: 'string',
          format: 'date-time',
        },
        { type: 'string' },
      ]);

      assert.deepStrictEqual(result, [
        {
          name: 'dateTime',
          position: 0,
          priority: 90,
          type: 'string',
        },
        {
          name: 'text',
          position: 1,
          type: 'string',
        },
      ] satisfies Varient[]);
    });

    it('names string based on const value', () => {
      const spec = createSpec();
      const result = findVarients(spec, [
        { type: 'string', const: 'active' },
        { type: 'string', const: '' },
      ]);

      assert.deepStrictEqual(result, [
        {
          name: 'active',
          position: 0,
          priority: 100,
          type: 'string',
        },
        {
          name: 'empty',
          position: 1,
          priority: 99,
          type: 'string',
        },
      ] satisfies Varient[]);
    });

    it.skip('names string based on enum values', () => {
      const spec = createSpec();
      const result = findVarients(spec, [
        { type: 'string', enum: ['pending', 'completed', ''] },
      ]);

      assert.deepStrictEqual(result, [
        {
          name: 'pending',
          position: 0,
          priority: 80,
          type: 'string',
        },
        {
          name: 'completed',
          position: 0,
          priority: 79,
          type: 'string',
        },
        {
          name: 'empty',
          position: 0,
          priority: 78,
          type: 'string',
        },
      ] satisfies Varient[]);
    });

    it.skip('prioritizes const first', () => {
      const spec = createSpec();
      const result = findVarients(spec, [
        { type: 'string', format: 'email' },
        { type: 'string', const: 'fixed' },
        { type: 'string', enum: ['option1', 'option2'] },
        { type: 'string' },
      ]);

      assert.deepStrictEqual(result, [
        {
          name: 'fixed',
          position: 1,
          priority: 99,
          type: 'string',
        },
        {
          name: 'email',
          position: 0,
          priority: 90,
          type: 'string',
        },
        {
          name: 'option1',
          position: 2,
          priority: 78,
          type: 'string',
        },
        {
          name: 'option2',
          position: 2,
          priority: 77,
          type: 'string',
        },
        {
          name: 'text',
          position: 3,
          type: 'string',
        },
      ] satisfies Varient[]);
    });

    it('handles format priority over enum', () => {
      const spec = createSpec();
      const result = findVarients(spec, [
        { type: 'string', format: 'email', enum: ['user@example.com'] },
      ]);

      assert.deepStrictEqual(result, [
        {
          name: 'email',
          position: 0,
          priority: 90,
          type: 'string',
        },
      ] satisfies Varient[]);
    });

    it('handles const priority over enum', () => {
      const spec = createSpec();
      const result = findVarients(spec, [
        { type: 'string', const: 'fixed', enum: ['option1', 'option2'] },
      ]);

      assert.deepStrictEqual(result, [
        {
          name: 'fixed',
          position: 0,
          priority: 100,
          type: 'string',
        },
      ] satisfies Varient[]);
    });

    it('handles complex format names with camelCase conversion', () => {
      const spec = createSpec();
      const result = findVarients(spec, [
        { type: 'string', format: 'date-time' },
        { type: 'string', format: 'iso-8601' },
        { type: 'string', format: 'binary' },
      ]);

      assert.deepStrictEqual(result, [
        {
          name: 'dateTime',
          position: 0,
          priority: 90,
          type: 'string',
        },
        {
          name: 'iso8601',
          position: 1,
          priority: 89,
          type: 'string',
        },
        {
          name: 'binary',
          position: 2,
          priority: 88,
          type: 'string',
        },
      ] satisfies Varient[]);
    });
  });

  describe('numbers', () => {
    it('names number type as number', () => {
      const spec = createSpec();
      const result = findVarients(spec, [{ type: 'number' }]);

      assert.deepStrictEqual(result, [
        {
          name: 'number',
          position: 0,
          type: 'number',
        },
      ] satisfies Varient[]);
    });

    it('names integer type as integer', () => {
      const spec = createSpec();
      const result = findVarients(spec, [{ type: 'integer' }]);

      assert.deepStrictEqual(result, [
        {
          name: 'number',
          position: 0,
          type: 'number',
        },
      ] satisfies Varient[]);
    });

    it('names number based on format', () => {
      const spec = createSpec();
      const result = findVarients(spec, [
        {
          type: 'number',
          format: 'float',
        },
        {
          type: 'number',
          format: 'double',
        },
        {
          type: 'integer',
          format: 'int64',
        },
        { type: 'number' },
      ]);

      assert.deepStrictEqual(result, [
        {
          name: 'float',
          position: 0,
          priority: 90,
          type: 'number',
        },
        {
          name: 'double',
          position: 1,
          priority: 89,
          type: 'number',
        },
        {
          name: 'integer',
          position: 2,
          priority: 87,
          type: 'number',
        },
        {
          name: 'number',
          position: 3,
          type: 'number',
        },
      ] satisfies Varient[]);
    });
  });

  describe('mixed types', () => {
    it('handles mixed string and number types', () => {
      const spec = createSpec();
      const result = findVarients(spec, [
        { type: 'number' },
        { type: 'string' },
      ]);
      assert.deepStrictEqual(result, [
        {
          name: 'text',
          position: 1,
          type: 'string',
        },
        {
          name: 'number',
          position: 0,
          type: 'number',
        },
      ] satisfies Varient[]);
    });
  });
});

describe('findPolymorphicVarients', () => {
  describe('strings', () => {
    it('returns single variant per position for multiple strings', () => {
      const spec = createSpec();
      const result = findPolymorphicVarients(spec, [
        { type: 'string', format: 'date-time' },
        { type: 'string' },
        { type: 'string', const: 'active' },
      ]);

      assert.deepStrictEqual(result, [
        {
          name: 'active',
          position: 2,
          priority: 98,
          type: 'string',
        },
        {
          name: 'dateTime',
          position: 0,
          priority: 90,
          type: 'string',
        },
        {
          name: 'text',
          position: 1,
          type: 'string',
        },
      ] satisfies Varient[]);
    });

    it.skip('returns first variant when multiple enums at same position', () => {
      const spec = createSpec();
      const result = findPolymorphicVarients(spec, [
        { type: 'string', enum: ['first', 'second', 'third'] },
      ]);

      assert.deepStrictEqual(result, [
        {
          name: 'first',
          position: 0,
          priority: 80,
          type: 'string',
        },
      ] satisfies Varient[]);
    });

    it.skip('selects first variant from multiple at same position', () => {
      const spec = createSpec();
      const result = findPolymorphicVarients(spec, [
        { type: 'string', enum: ['option1', 'option2'] },
        { type: 'string', format: 'email' },
      ]);

      assert.deepStrictEqual(result, [
        {
          name: 'email',
          position: 1,
          priority: 88,
          type: 'string',
        },
        {
          name: 'option1',
          position: 0,
          priority: 80,
          type: 'string',
        },
      ] satisfies Varient[]);
    });

    it.skip('handles mixed types selecting one per position', () => {
      const spec = createSpec();
      const result = findPolymorphicVarients(spec, [
        { type: 'string', enum: ['a', 'b'] },
        { type: 'number' },
        { type: 'string', const: 'fixed' },
      ]);

      assert.deepStrictEqual(result, [
        {
          name: 'fixed',
          position: 2,
          priority: 98,
          type: 'string',
        },
        {
          name: 'a',
          position: 0,
          priority: 80,
          type: 'string',
        },
        {
          name: 'number',
          position: 1,
          type: 'number',
        },
      ] satisfies Varient[]);
    });

    it('handles plain strings mixed with formatted strings', () => {
      const spec = createSpec();
      const result = findPolymorphicVarients(spec, [
        { type: 'string' },
        { type: 'string', format: 'password' },
      ]);

      assert.deepStrictEqual(result, [
        {
          name: 'password',
          position: 1,
          priority: 89,
          type: 'string',
        },
        {
          name: 'text',
          position: 0,
          type: 'string',
        },
      ] satisfies Varient[]);
    });
    it('ignore duplicates', () => {
      const spec = createSpec();
      const result = findPolymorphicVarients(spec, [
        { type: 'string' },
        { type: 'string', format: 'password' },
        { type: 'string' },
      ]);

      assert.deepStrictEqual(result, [
        {
          name: 'password',
          position: 1,
          priority: 89,
          type: 'string',
        },
        {
          name: 'text',
          position: 0,
          type: 'string',
        },
      ] satisfies Varient[]);
    });
  });

  describe('numbers', () => {
    it('returns single variant per position for multiple numbers', () => {
      const spec = createSpec();
      const result = findPolymorphicVarients(spec, [
        { type: 'number', format: 'float' },
        { type: 'integer' },
        { type: 'number', format: 'double' },
      ]);

      assert.deepStrictEqual(result, [
        {
          name: 'float',
          position: 0,
          priority: 90,
          type: 'number',
        },
        {
          name: 'double',
          position: 2,
          priority: 89,
          type: 'number',
        },
        {
          name: 'number',
          position: 1,
          type: 'number',
        },
      ] satisfies Varient[]);
    });

    it('returns first variant when multiple number formats at same position', () => {
      const spec = createSpec();
      const result = findPolymorphicVarients(spec, [
        { type: 'number', format: 'float' },
        { type: 'number', format: 'double' },
      ]);

      assert.deepStrictEqual(result, [
        {
          name: 'float',
          position: 0,
          priority: 90,
          type: 'number',
        },
        {
          name: 'double',
          position: 1,
          priority: 89,
          type: 'number',
        },
      ] satisfies Varient[]);
    });

    it('handles mixed number and integer types', () => {
      const spec = createSpec();
      const result = findPolymorphicVarients(spec, [
        { type: 'integer', format: 'int64' },
        { type: 'number' },
        { type: 'integer' },
      ]);

      assert.deepStrictEqual(result, [
        {
          name: 'integer',
          position: 0,
          priority: 89,
          type: 'number',
        },
        {
          name: 'number',
          position: 1,
          type: 'number',
        },
        {
          name: 'number',
          position: 2,
          type: 'number',
        },
      ] satisfies Varient[]);
    });

    it('handles plain numbers mixed with formatted numbers', () => {
      const spec = createSpec();
      const result = findPolymorphicVarients(spec, [
        { type: 'number' },
        { type: 'number', format: 'float' },
        { type: 'number' },
      ]);

      assert.deepStrictEqual(result, [
        {
          name: 'float',
          position: 1,
          priority: 89,
          type: 'number',
        },
        {
          name: 'number',
          position: 0,
          type: 'number',
        },
        {
          name: 'number',
          position: 2,
          type: 'number',
        },
      ] satisfies Varient[]);
    });
  });

  describe('arrays', () => {
    it.only('complex', () => {
      const spec = createSpec({
        components: {
          schemas: {
            RouteConfig: {
              anyOf: [
                {
                  type: 'array',
                  items: {
                    anyOf: [
                      {
                        type: 'string',
                        enum: ['image', 'video', 'audio'],
                      },
                      {
                        type: 'string',
                        enum: [
                          'application/andrew-inset',
                          'application/applixware',
                        ],
                      },
                    ],
                  },
                },
                {
                  type: 'object',
                  additionalProperties: {
                    type: 'object',
                    properties: {
                      maxFileSize: {
                        type: 'string',
                        description:
                          'The maximum file size allowed for a given file type.',
                        example: '4MB',
                      },
                      maxFileCount: {
                        type: 'number',
                        description:
                          'Maximum allowed files for a given file type.',
                        example: 1,
                      },
                      contentDisposition: {
                        type: 'string',
                        enum: ['inline', 'attachment'],
                        default: 'inline',
                      },
                      acl: {
                        type: 'string',
                        enum: ['public-read', 'private'],
                      },
                    },
                  },
                },
              ],
            },
          },
        },
      });
      const varients = findVarients(
        spec,
        (spec.components.schemas.RouteConfig as SchemaObject).anyOf ?? [],
      );

      assert.deepStrictEqual(varients, [
        {
          name: 'textList',
          type: 'array',
          subtype: 'string',
          position: 0,
        },
        {
          static: true,
          subtype: 'string',
          source: 'public-read',
          name: 'public-read',
          type: 'object',
          position: 1,
        },
      ]);
    });
  });
});
