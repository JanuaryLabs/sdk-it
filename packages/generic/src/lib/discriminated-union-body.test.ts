import assert from 'node:assert/strict';
import { test } from 'node:test';

import { openAnalysisProject } from '@sdk-it/core/program.js';
import { analyze } from '@sdk-it/generic';
import { responseAnalyzer } from '@sdk-it/hono';
import { analysisWorkspace } from '@sdk-it/testing';

const routes = `import { Hono } from 'hono';
import { z } from 'zod';
import { validate } from '@sdk-it/hono/runtime';

export const app = new Hono();

/**
 * @openapi recordIntake
 */
app.post('/patients', validate('application/json', (payload) => ({
  medications: {
    select: payload.body.medications,
    against: z.discriminatedUnion('answer', [
      z.object({ answer: z.literal('none') }),
      z.object({ answer: z.literal('yes'), entries: z.array(z.string()).min(1) }),
      z.object({ answer: z.literal('skip') }),
    ]),
  },
})), (c) => c.body(null, 204));
`;

test('a discriminated union body property is documented as oneOf with its discriminator', async () => {
  await using dir = await analysisWorkspace('discriminated-union-', {
    'route.ts': routes,
  });
  using project = openAnalysisProject(dir.tsconfig);
  const { paths, components } = JSON.parse(
    JSON.stringify(await analyze(project, { responseAnalyzer })),
  );

  const body =
    paths['/patients'].post.requestBody.content['application/json'].schema;
  const resolve = (schema: { $ref?: string }) =>
    schema.$ref
      ? components.schemas[schema.$ref.replace('#/components/schemas/', '')]
      : schema;
  assert.deepStrictEqual(resolve(resolve(body).properties.medications), {
    oneOf: [
      {
        type: 'object',
        properties: { answer: { type: 'string', const: 'none' } },
        required: ['answer'],
        additionalProperties: false,
      },
      {
        type: 'object',
        properties: {
          answer: { type: 'string', const: 'yes' },
          entries: { type: 'array', items: { type: 'string' }, minItems: 1 },
        },
        required: ['answer', 'entries'],
        additionalProperties: false,
      },
      {
        type: 'object',
        properties: { answer: { type: 'string', const: 'skip' } },
        required: ['answer'],
        additionalProperties: false,
      },
    ],
    discriminator: { propertyName: 'answer' },
  });
});
