import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { OpenAPIObject } from 'openapi3-ts/oas31';

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
