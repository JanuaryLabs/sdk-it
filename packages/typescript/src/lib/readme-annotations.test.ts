import { TemporaryFiles } from '@zukhruf/fs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import type {
  OpenAPIObject,
  ReferenceObject,
  SchemaObject,
} from 'openapi3-ts/oas31';

import { generate } from '@sdk-it/typescript';

function ordersWith(
  properties: Record<string, SchemaObject | ReferenceObject>,
): OpenAPIObject {
  return {
    openapi: '3.1.0',
    info: { title: 'Orders', version: '1.0.0' },
    servers: [{ url: 'https://orders.test' }],
    components: {
      schemas: {
        Status: {
          type: 'string',
          enum: ['open', 'closed'],
          description: 'The status of any record.',
          default: 'closed',
        },
        Legacy: { type: 'string', deprecated: true },
      },
    },
    paths: {
      '/orders': {
        post: {
          operationId: 'createOrder',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { type: 'object', properties },
              },
            },
          },
          responses: { '204': { description: 'Created' } },
        },
      },
    },
  };
}

test('the README shows the description and default written beside a $ref, and the target fills what the property leaves out', async () => {
  await using output = await new TemporaryFiles().directory('readme-ref-');
  await generate(
    ordersWith({
      status: {
        $ref: '#/components/schemas/Status',
        description: 'Where the order is.',
        default: 'open',
      },
      previous: { $ref: '#/components/schemas/Status' },
    }),
    {
      output: output.path,
      name: 'Orders',
      packageName: '@acme/orders',
      readme: true,
    },
  );

  const readme = await readFile(join(output.path, 'README.md'), 'utf8');

  assert.match(
    readme,
    /- `status` \[`Status`\]\(#status\) default: "open":\n+ *Where the order is\.\n/,
  );
  assert.match(
    readme,
    /- `previous` \[`Status`\]\(#status\) default: "closed":\n+ *The status of any record\.\n/,
  );
});

test('the README marks a deprecated property, inline and through a $ref', async () => {
  await using output = await new TemporaryFiles().directory(
    'readme-deprecated-',
  );
  await generate(
    ordersWith({
      note: { type: 'string', deprecated: true },
      code: { $ref: '#/components/schemas/Legacy' },
      name: { type: 'string' },
    }),
    {
      output: output.path,
      name: 'Orders',
      packageName: '@acme/orders',
      readme: true,
    },
  );

  const readme = await readFile(join(output.path, 'README.md'), 'utf8');

  assert.match(readme, /- `note` `string`:\n+ *\*\*Deprecated\*\*\n/);
  assert.match(
    readme,
    /- `code` \[`Legacy`\]\(#legacy\):\n+ *\*\*Deprecated\*\*\n/,
  );
  assert.match(readme, /- `name` `string`:\n+- `note`/);
});

test('the README shows the default beside a $ref parameter or response schema, and the target default when there is none beside it', async () => {
  await using output = await new TemporaryFiles().directory('readme-ref-top-');
  await generate(
    {
      openapi: '3.1.0',
      info: { title: 'Orders', version: '1.0.0' },
      servers: [{ url: 'https://orders.test' }],
      components: {
        schemas: {
          Status: {
            type: 'string',
            enum: ['open', 'closed'],
            default: 'closed',
          },
        },
      },
      paths: {
        '/orders': {
          get: {
            operationId: 'listOrders',
            parameters: [
              {
                in: 'query',
                name: 'status',
                schema: {
                  $ref: '#/components/schemas/Status',
                  default: 'open',
                },
              },
              {
                in: 'query',
                name: 'previous',
                schema: { $ref: '#/components/schemas/Status' },
              },
            ],
            responses: {
              '200': {
                description: 'The status',
                content: {
                  'application/json': {
                    schema: {
                      $ref: '#/components/schemas/Status',
                      default: 'open',
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    {
      output: output.path,
      name: 'Orders',
      packageName: '@acme/orders',
      readme: true,
    },
  );

  const readme = await readFile(join(output.path, 'README.md'), 'utf8');

  assert.match(
    readme,
    /\| `status` \| query \| \[`Status`\]\(#status\) default: "open" \|/,
  );
  assert.match(
    readme,
    /\| `previous` \| query \| \[`Status`\]\(#status\) default: "closed" \|/,
  );
  assert.match(
    readme,
    /\*\*200\*\* - The status[\s\S]*?\*\*Type:\*\* \[`Status`\]\(#status\)\n+\*\*Default:\*\* `"open"`\n/,
  );
});

test('the README example call sends the default written beside a $ref, the target default otherwise, and an inline default', async () => {
  await using output = await new TemporaryFiles().directory('readme-example-');
  await generate(
    ordersWith({
      status: { $ref: '#/components/schemas/Status', default: 'open' },
      previous: { $ref: '#/components/schemas/Status' },
      note: { type: 'string', default: 'none' },
    }),
    {
      output: output.path,
      name: 'Orders',
      packageName: '@acme/orders',
      readme: true,
    },
  );

  const readme = await readFile(join(output.path, 'README.md'), 'utf8');

  assert.match(
    readme,
    /orders\.request\('POST \/orders', \{\n {2}"note": "none",\n {2}"previous": "closed",\n {2}"status": "open"\n\}\)/,
  );
});
