import assert from 'node:assert/strict';
import { test } from 'node:test';

import { openAnalysisProject } from '@sdk-it/core/program.js';
import { analyze } from '@sdk-it/generic';
import { responseAnalyzer } from '@sdk-it/hono';
import {
  carriesBinary,
  forEachOperation,
  operationInputs,
  toIR,
} from '@sdk-it/spec';
import { analysisWorkspace } from '@sdk-it/testing';

// globalThis.File reaches the class only at run time: no text match on the
// against can read it as a file.
const route = `import { Hono } from 'hono';
import { z } from 'zod';
import { validate } from '@sdk-it/hono/runtime';

export const app = new Hono();

/** @openapi upload */
app.post('/uploads', validate('multipart/form-data', (payload) => ({
  file: { select: payload.body.file, against: z.instanceof(globalThis.File) },
})), (c) => c.body(null, 204));
`;

test('a z.instanceof(File) against is a file input, which carries binary', async () => {
  // Arrange
  await using workspace = await analysisWorkspace('instanceof-file-against-', {
    'route.ts': route,
  });
  using project = openAnalysisProject(workspace.tsconfig);
  const spec = await analyze(project, { responseAnalyzer });
  const ir = await toIR({
    spec: {
      openapi: '3.1.0',
      info: { title: 'Uploads', version: '1.0.0' },
      paths: spec.paths,
      components: spec.components,
    },
  });

  // Act
  const binary: Record<string, boolean[]> = {};
  forEachOperation(ir, (entry, operation) => {
    binary[entry.path] = operationInputs(ir, operation).map((input) =>
      carriesBinary(ir, input),
    );
  });

  // Assert
  assert.deepEqual(binary, { '/uploads': [true] });
});
