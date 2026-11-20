import { TemporaryFiles } from '@zukhruf/fs';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

import { Documents, SpecLoader } from '@sdk-it/spec';

test('a SpecLoader bundles the entry content its Documents hold without reading the entry, and resolves its references against the entry URL', async () => {
  await using dir = await new TemporaryFiles().directory('sdk-it-spec-loader-');
  await writeFile(
    join(dir.path, 'pet.yaml'),
    ['type: object', 'properties:', '  id: { type: string }'].join('\n'),
  );
  const entry = pathToFileURL(join(dir.path, 'openapi.yaml'));
  const documents = Documents.standard([
    [
      entry,
      {
        openapi: '3.1.0',
        info: { title: 'Pets', version: '1.0.0' },
        paths: {
          '/pets': {
            get: {
              operationId: 'listPets',
              responses: {
                '200': {
                  description: 'Pets',
                  content: {
                    'application/json': { schema: { $ref: './pet.yaml' } },
                  },
                },
              },
            },
          },
        },
      },
    ],
  ]);

  const spec = await new SpecLoader(documents).load(entry);

  assert.deepEqual(spec.components?.schemas, {
    pet: { type: 'object', properties: { id: { type: 'string' } } },
  });
  assert.deepEqual(
    spec.paths?.['/pets']?.get?.responses?.['200']?.content?.[
      'application/json'
    ]?.schema,
    { $ref: '#/components/schemas/pet' },
  );
  assert.deepEqual(documents.uris(), [
    entry.href,
    pathToFileURL(join(dir.path, 'pet.yaml')).href,
  ]);
});
