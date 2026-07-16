import assert from 'node:assert/strict';
import { test } from 'node:test';

import { extractInlineSchemas, processSpec } from '@sdk-it/spec';

test('inline schema extraction never overwrites an authored component name', async () => {
  const { spec } = await processSpec({
    spec: {
      openapi: '3.1.0',
      info: { title: 'Schemas', version: '1.0.0' },
      components: {
        schemas: {
          UserProfile: {
            type: 'object',
            description: 'Authored component',
            properties: { id: { type: 'string' } },
          },
          User: {
            type: 'object',
            properties: {
              profile: {
                type: 'object',
                properties: { displayName: { type: 'string' } },
              },
            },
          },
        },
      },
      paths: {},
    },
    plugins: [extractInlineSchemas()],
  });

  assert.strictEqual(
    spec.components.schemas.UserProfile.description,
    'Authored component',
  );
  const user = spec.components.schemas.User;
  assert.ok(!('$ref' in user));
  const profile = user.properties?.profile;
  assert.ok(profile && '$ref' in profile);
  assert.strictEqual(profile.$ref, '#/components/schemas/UserProfileProperty');
  const extractedProfile = spec.components.schemas.UserProfileProperty;
  assert.ok(!('$ref' in extractedProfile));
  assert.deepStrictEqual(extractedProfile.properties, {
    displayName: { type: 'string' },
  });
});
