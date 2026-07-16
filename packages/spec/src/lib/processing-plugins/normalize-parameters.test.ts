import assert from 'node:assert/strict';
import { test } from 'node:test';

import { normalizeParameters, processSpec } from '@sdk-it/spec';

test('operation parameters override path parameters with the same location and name', async () => {
  const { spec } = await processSpec({
    spec: {
      openapi: '3.1.0',
      info: { title: 'Parameters', version: '1.0.0' },
      paths: {
        '/users/{userId}': {
          parameters: [
            {
              in: 'path',
              name: 'userId',
              required: true,
              description: 'Path default',
              schema: { type: 'string' },
            },
          ],
          get: {
            parameters: [
              {
                in: 'path',
                name: 'userId',
                required: true,
                description: 'Operation override',
                schema: { type: 'string', format: 'uuid' },
              },
            ],
            responses: {},
          },
        },
      },
    },
    plugins: [normalizeParameters()],
  });

  const parameters = spec.paths['/users/{userId}'].get?.parameters ?? [];
  assert.strictEqual(parameters.length, 1);
  assert.strictEqual(
    '$ref' in parameters[0] ? undefined : parameters[0].description,
    'Operation override',
  );
});
