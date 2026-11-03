import { TemporaryFiles } from '@zukhruf/testing/fs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import type { OpenAPIObject } from 'openapi3-ts/oas31';

import { writeFiles } from '@sdk-it/core/file-system.js';
import { generate } from '@sdk-it/python';

test('generates Never for impossible response schemas', async () => {
  await using workspace = await new TemporaryFiles().directory(
    'python-generate-never-',
  );
  const output = workspace.path;
  const spec: OpenAPIObject = {
    openapi: '3.1.0',
    info: { title: 'Impossible response', version: '1.0.0' },
    components: {
      schemas: {
        Impossible: { not: {} },
        ImpossibleList: {
          type: 'array',
          items: { $ref: '#/components/schemas/Impossible' },
        },
        Container: {
          type: 'object',
          properties: {
            value: { $ref: '#/components/schemas/Impossible' },
            values: { $ref: '#/components/schemas/ImpossibleList' },
          },
        },
      },
    },
    paths: {
      '/impossible': {
        get: {
          operationId: 'listImpossible',
          tags: ['impossible'],
          responses: {
            '200': {
              description: 'OK',
              content: {
                'application/json': {
                  schema: {
                    type: 'array',
                    items: { not: {} },
                  },
                },
              },
            },
          },
        },
      },
      '/impossible-value': {
        get: {
          operationId: 'getImpossible',
          tags: ['impossible'],
          responses: {
            '200': {
              description: 'OK',
              content: {
                'application/json': {
                  schema: { not: {} },
                },
              },
            },
          },
        },
      },
      '/impossible-ref-list': {
        get: {
          operationId: 'listImpossibleRef',
          tags: ['impossible'],
          responses: {
            '200': {
              description: 'OK',
              content: {
                'application/json': {
                  schema: {
                    $ref: '#/components/schemas/ImpossibleList',
                  },
                },
              },
            },
          },
        },
      },
      '/ordinary': {
        get: {
          operationId: 'listOrdinary',
          tags: ['impossible'],
          responses: {
            '200': {
              description: 'OK',
              content: {
                'application/json': {
                  schema: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                      },
                      required: ['id'],
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  };

  await generate(spec, { output, name: 'Impossible', mode: 'full' });

  const source = readFileSync(join(output, 'api', 'impossible_api.py'), 'utf8');
  const requirements = readFileSync(join(output, 'requirements.txt'), 'utf8');
  const model = readFileSync(join(output, 'models', 'container.py'), 'utf8');
  assert.match(requirements, /typing-extensions>=4\.1\.0/);
  assert.match(model, /from typing_extensions import Annotated, Never/);
  assert.match(
    model,
    /_NeverValue = Annotated\[Any, BeforeValidator\(_reject_never\)\]/,
  );
  assert.match(
    model,
    /value: _NeverValue = Field\(default=None, exclude=True\)/,
  );
  assert.match(model, /values: Optional\[List\[_NeverValue\]\] = None/);
  assert.match(source, /from typing import [^\n]*\bList\b/);
  assert.match(source, /from typing_extensions import Never/);
  assert.match(source, /async def list_impossible\([^)]*\) -> List\[Never\]:/);
  assert.match(
    source,
    /async def list_impossible_ref\([^)]*\) -> List\[Never\]:/,
  );
  assert.match(source, /async def get_impossible\([^)]*\) -> Never:/);
  assert.match(source, /async def list_ordinary\([^)]*\) -> Any:/);
  assert.equal(
    source.match(/receiver\.json\(response, None, None\)/g)?.length,
    4,
  );
});

test('generate writes metadata.json through the caller writer', async () => {
  await using workspace = await new TemporaryFiles().directory(
    'python-metadata-writer-',
  );
  const output = workspace.path;
  const written: string[] = [];

  await generate(
    {
      openapi: '3.1.0',
      info: { title: 'Pets', version: '1.0.0' },
      paths: {
        '/pets': {
          get: {
            operationId: 'listPets',
            tags: ['pets'],
            responses: { '200': { description: 'OK' } },
          },
        },
      },
    },
    {
      output,
      writer: async (folder, contents) => {
        for (const file of Object.keys(contents)) {
          written.push(relative(output, join(folder, file)));
        }
        await writeFiles(folder, contents);
      },
    },
  );

  assert.ok(written.includes('metadata.json'), written.join('\n'));
});
