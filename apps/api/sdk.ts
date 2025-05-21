import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  analyze,
  responseAnalyzer as genericResponseAnalyzer,
} from '@sdk-it/generic';
import { responseAnalyzer } from '@sdk-it/hono';
import { generate } from '@sdk-it/typescript';

const { paths, components } = await analyze('apps/api/tsconfig.app.json', {
  responseAnalyzer: {
    ...genericResponseAnalyzer,
    ...responseAnalyzer,
  },
  onOperation: (sourceFile, method, path, operation) => {
    operation.responses ??= {};
    const existing400 = operation.responses[400];
    operation.responses[400] = {
      description: 'Bad Request',
      content: {
        'application/json': {
          schema: {
            oneOf: [
              existing400?.content?.['application/json'],
              { $ref: '#/components/schemas/ValidationError' },
            ].filter(Boolean),
          },
        },
      },
    };
    return {};
  },
});

const spec = {
  openapi: '3.1.0',
  info: { title: 'SDK-IT API', version: '1.0.0' },
  servers: [
    {
      url: '/',
      description: 'Same host',
    },
    { url: 'http://localhost:3000', description: 'Local Server' },
  ],
  security: [{ bearer: [] }],
  paths,
  components: {
    ...components,
    schemas: {
      ...components.schemas,
      ValidationError: {
        type: 'object',
        properties: {
          message: { type: 'string' },
        },
      } as const,
    },
    securitySchemes: {
      bearer: {
        type: 'http',
        scheme: 'bearer',
      } as const,
    },
  },
};

await writeFile(
  join(process.cwd(), 'openapi.json'),
  JSON.stringify(spec, null, 2),
  'utf-8',
);
await generate(
  // await loadSpec(join(cwd(), '.yamls', 'hetzner.json')),
  spec,
  // await loadSpec('https://api.uploadthing.com/openapi-spec.json'),
  {
    mode: 'full',
    name: 'SdkIt',
    output: join(process.cwd(), 'packages/client'),
    // output: join(process.cwd(), 'node_modules/@local/client'),
    style: {
      outputType: 'default',
      errorAsValue: false,
    },
    formatCode: ({ output, env }) => {
      execFile('prettier', ['openapi.json', output, '--write'], { env: env });
    },
  },
);

console.log('OpenAPI client generated successfully!');
