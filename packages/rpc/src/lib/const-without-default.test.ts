import { TemporaryFiles } from '@zukhruf/fs';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import { rpc } from '@sdk-it/rpc';
import { parseErrorFor } from '@sdk-it/testing';

const spec = {
  openapi: '3.1.0',
  info: { title: 'Patients', version: '1.0.0' },
  servers: [{ url: 'https://api.example.com' }],
  paths: {
    '/patients': {
      post: {
        operationId: 'recordIntake',
        tags: ['patients'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  kind: { type: 'string', const: 'intake' },
                  medications: {
                    oneOf: [
                      {
                        type: 'object',
                        properties: {
                          answer: { type: 'string', const: 'none' },
                        },
                        required: ['answer'],
                      },
                      {
                        type: 'object',
                        properties: {
                          answer: { type: 'string', const: 'yes' },
                          entries: {
                            type: 'array',
                            items: { type: 'string' },
                            minItems: 1,
                          },
                        },
                        required: ['answer', 'entries'],
                      },
                      {
                        type: 'object',
                        properties: {
                          answer: { type: 'string', const: 'skip' },
                        },
                        required: ['answer'],
                      },
                    ],
                  },
                },
                required: ['kind', 'medications'],
              },
            },
          },
        },
        responses: { '204': { description: 'Recorded' } },
      },
    },
  },
};

test('a const property the input leaves out is refused, not filled with its value', async () => {
  await using dir = await new TemporaryFiles().directory('rpc-const-default-');
  const specPath = join(dir.path, 'spec.json');
  await writeFile(specPath, JSON.stringify(spec));
  const client = await rpc(specPath, {
    fetch: async () => new Response(null, { status: 204 }),
  });

  await assert.rejects(
    client.request('POST /patients', { kind: 'intake', medications: {} }),
    parseErrorFor('medications'),
  );
  await assert.rejects(
    client.request('POST /patients', { medications: { answer: 'none' } }),
    parseErrorFor('kind'),
  );
  await assert.doesNotReject(
    client.request('POST /patients', {
      kind: 'intake',
      medications: { answer: 'none' },
    }),
  );
});
