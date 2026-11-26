import { test } from '@zukhruf/parameterized-test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { loadSpec } from '@sdk-it/spec';
import { parseErrorFor, workspaceDirectory } from '@sdk-it/testing';
import { generate } from '@sdk-it/typescript';

// dose is what zod writes for z.number().positive().multipleOf(0.001)
// .lt(10_000_000), the schema of Meddit's doseAmount (#5130).
const document = `
openapi: 3.1.0
info: { title: Doses, version: 1.0.0 }
servers: [{ url: 'https://api.test' }]
paths:
  /doses:
    post:
      operationId: recordDose
      tags: [doses]
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [dose, count]
              properties:
                dose:
                  type: number
                  exclusiveMinimum: 0
                  multipleOf: 0.001
                  exclusiveMaximum: 10000000
                count:
                  type: integer
                  multipleOf: 5
      responses:
        '204': { description: Recorded }
`;

void test('a generated client accepts every decimal multiple of multipleOf and refuses the rest', async () => {
  // Arrange
  await using workspace = await workspaceDirectory('multiple-of-');
  const file = join(workspace.path, 'openapi.yaml');
  await writeFile(file, document);
  await generate((await loadSpec(file)).spec, {
    output: workspace.path,
    name: 'Doses',
    packageName: '@acme/doses',
    readme: false,
    mode: 'full',
  });
  const { createDoses } = await import(
    pathToFileURL(join(workspace.path, 'src/index.ts')).href
  );
  const client = createDoses({
    baseUrl: 'https://api.test',
    fetch: async () => new Response(null, { status: 204 }),
  });

  // Act and assert
  for (const dose of [0.7, 0.35, 1.005, 2.675]) {
    await assert.doesNotReject(
      client.request('POST /doses', { dose, count: 10 }),
      `dose ${dose}`,
    );
  }
  for (const dose of [0.0004, 0.0015, 1.0005]) {
    await assert.rejects(
      client.request('POST /doses', { dose, count: 10 }),
      parseErrorFor('dose'),
      `dose ${dose}`,
    );
  }
  await assert.rejects(
    client.request('POST /doses', { dose: 0.7, count: 7 }),
    parseErrorFor('count'),
  );
});
