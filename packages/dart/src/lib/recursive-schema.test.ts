import { TemporaryFiles } from '@zukhruf/testing/fs';
import { test } from '@zukhruf/testing/node';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { OpenAPIObject } from 'openapi3-ts/oas31';

import { generate } from '@sdk-it/dart';

void test('a self-referencing array component generates instead of recursing forever', async () => {
  await using workspace = await new TemporaryFiles().directory(
    'sdk-it-dart-recursive-',
  );
  const output = join(workspace.path, 'client');
  const spec: OpenAPIObject = {
    openapi: '3.1.0',
    info: { title: 'Chat API', version: '1.0.0' },
    components: {
      schemas: {
        JsonArray: {
          type: 'array',
          items: {
            anyOf: [
              { type: 'string' },
              { $ref: '#/components/schemas/JsonArray' },
            ],
          },
        },
        Message: {
          type: 'object',
          properties: { parts: { $ref: '#/components/schemas/JsonArray' } },
          required: ['parts'],
        },
      },
    },
    paths: {
      '/messages': {
        get: {
          operationId: 'listMessages',
          tags: ['messages'],
          responses: {
            '200': {
              description: 'Messages',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Message' },
                },
              },
            },
          },
        },
      },
    },
  };

  await generate(spec, { output, name: 'Trees' });

  const message = await readFile(
    join(output, 'lib/outputs/message.dart'),
    'utf8',
  );
  assert.match(message, /final List<JsonArray> parts/);
});
