import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import type { OpenAPIObject } from 'openapi3-ts/oas31';

import { writeFiles } from '@sdk-it/core/file-system.js';
import { generate } from '@sdk-it/dart';

test('generates Never for impossible response schemas', async () => {
  const output = mkdtempSync(join(tmpdir(), 'dart-generate-never-'));
  try {
    const spec: OpenAPIObject = {
      openapi: '3.1.0',
      info: { title: 'Impossible response', version: '1.0.0' },
      components: {
        schemas: {
          Container: {
            type: 'object',
            properties: {
              value: { not: {} },
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
        '/impossible/direct': {
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
      },
    };

    await generate(spec, { output, name: 'Impossible' });

    const source = readFileSync(
      join(output, 'lib', 'api', 'impossible.dart'),
      'utf8',
    );
    assert.match(source, /Future<List<Never>> listImpossible/);
    assert.match(source, /Future<Never> getImpossible/);

    const model = readFileSync(
      join(output, 'lib', 'models', 'container.dart'),
      'utf8',
    );
    assert.match(model, /final Never\? value/);
    assert.match(
      model,
      /value: json\.containsKey\('value'\) \? json\['value'\] as Never : null/,
    );
    assert.match(model, /if \(value != null\) 'value': value/);
    assert.match(model, /!json\.containsKey\('value'\)/);
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});

test('generates schemas with common properties and inline oneOf variants', async () => {
  const output = mkdtempSync(join(tmpdir(), 'dart-generate-inline-one-of-'));
  try {
    const spec: OpenAPIObject = {
      openapi: '3.1.0',
      info: { title: 'Subscriptions', version: '1.0.0' },
      components: {
        schemas: {
          SubscriptionRequest: {
            type: 'object',
            allOf: [
              {
                properties: {
                  pageId: { type: 'string' },
                },
              },
              {
                oneOf: [
                  {
                    type: 'object',
                    properties: { email: { type: 'string' } },
                    required: ['email'],
                  },
                  {
                    type: 'object',
                    properties: { webhook: { type: 'string' } },
                    required: ['webhook'],
                  },
                ],
              },
            ],
          },
        },
      },
      paths: {
        '/subscriptions': {
          post: {
            operationId: 'createSubscription',
            tags: ['subscriptions'],
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    $ref: '#/components/schemas/SubscriptionRequest',
                  },
                },
              },
            },
            responses: { '204': { description: 'Created' } },
          },
        },
      },
    };

    await generate(spec, { output, name: 'Subscriptions' });
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});

test('generate writes metadata.json through the caller writer', async () => {
  const output = mkdtempSync(join(tmpdir(), 'dart-metadata-writer-'));
  try {
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
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});
