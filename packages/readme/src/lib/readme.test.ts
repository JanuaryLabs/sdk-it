import assert from 'node:assert/strict';
import { test } from 'node:test';

import { toReadme } from '@sdk-it/readme';
import { toIR } from '@sdk-it/spec';

test('readme opens with the seeded overview page and does not repeat it', async () => {
  const spec = await toIR({
    spec: {
      openapi: '3.1.0',
      info: {
        title: 'Acme API',
        version: '1.0.0',
        description: 'Acme lets you ship.',
      },
      paths: {},
      'x-docs': [
        {
          id: 'overview',
          title: 'Getting started',
          description: 'Start here.',
        },
      ],
      'x-sdks': [{ language: 'typescript', package: '@acme/sdk' }],
    },
  });

  const readme = toReadme(spec);

  assert.ok(
    readme.startsWith(
      '# Getting started\n\nStart here.\n\nAcme lets you ship.',
    ),
    readme.slice(0, 200),
  );
  assert.equal(readme.match(/# Getting started/g)?.length, 1);
  assert.match(readme, /npm install @acme\/sdk/);
  assert.match(readme, /# Authentication/);
  assert.match(readme, /# Error Handling/);
});
