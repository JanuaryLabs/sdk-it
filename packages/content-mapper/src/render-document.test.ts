import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

import { DiagnosticCode, renderDocument } from '@sdk-it/content-mapper';
import { workspaceDirectory } from '@sdk-it/testing';

const document = `openapi: 3.1.0
info: { title: Store, version: 1.0.0 }
paths:
  /pets:
    get:
      operationId: listPets
      responses:
        '200':
          description: Pets
          content:
            application/json:
              schema: { $ref: './pet.yaml' }
`;

test('a document renders to its module, with the client names mapped to its title and the documents it read', async () => {
  await using dir = await workspaceDirectory('render-document-');
  const fileName = join(dir.path, 'store.openapi.yaml');
  await writeFile(join(dir.path, 'pet.yaml'), 'type: object\n');

  const rendered = await renderDocument(fileName, document);

  assert.equal(rendered.kind, 'module');
  const named = rendered.mappings
    .filter(
      ({ original }) =>
        document.slice(original.start, original.end) === 'Store',
    )
    .map(({ generated }) =>
      rendered.text.slice(generated.start, generated.end),
    );
  assert.deepEqual(named.toSorted(), ['createStore', 'store']);
  assert.deepEqual(rendered.documents, [
    pathToFileURL(fileName).href,
    pathToFileURL(join(dir.path, 'pet.yaml')).href,
  ]);
});

test('a document whose $ref does not resolve fails at the $ref value and still lists the missing file', async () => {
  await using dir = await workspaceDirectory('render-document-');
  const fileName = join(dir.path, 'store.openapi.yaml');

  const rendered = await renderDocument(fileName, document);

  assert.equal(rendered.kind, 'failed');
  const [failure] = rendered.diagnostics;
  assert.equal(failure.code, DiagnosticCode.Load);
  assert.equal(
    document.slice(failure.range.start, failure.range.end),
    "'./pet.yaml'",
  );
  assert.ok(
    rendered.documents.includes(pathToFileURL(join(dir.path, 'pet.yaml')).href),
  );
});
