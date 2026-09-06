import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  type IR,
  extractOverviewDocsPlugin,
  processSpec,
  toSidebar,
} from '@sdk-it/spec';

function acmeSpec(extensions: Record<string, unknown> = {}) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Acme API',
      version: '2.0.0',
      description: 'Acme lets you ship.',
    },
    servers: [{ url: 'https://api.acme.dev', description: 'Production' }],
    paths: {},
    ...extensions,
  };
}

function pages(spec: IR) {
  return spec['x-docs'].flatMap((category) => category.items);
}

test('generates overview, authorization, and errors pages whose urls agree with their ids', async () => {
  const { spec, diagnostics } = await processSpec({
    spec: acmeSpec(),
    plugins: [extractOverviewDocsPlugin()],
  });

  const items = pages(spec);
  assert.deepEqual(
    spec['x-docs'].map((category) => category.category),
    ['Overview'],
  );
  assert.deepEqual(
    items.map((item) => [item.id, item.url]),
    [
      ['overview', '/'],
      ['authorization', '/authorization'],
      ['errors', '/errors'],
    ],
  );
  const overview = items[0].content ?? '';
  assert.match(
    overview,
    /^# Acme API\n\nAcme lets you ship\.\n\n\*\*Version:\*\* 2\.0\.0/,
  );
  assert.match(overview, /- \*\*https:\/\/api\.acme\.dev\*\* - Production/);
  assert.doesNotMatch(overview, /Official API Client|TYPESCRIPT/);
  assert.deepEqual(spec['x-sdks'], []);
  assert.deepEqual(diagnostics, []);
});

test('an authored x-docs entry seeds the generated page it matches', async () => {
  const { spec, diagnostics } = await processSpec({
    spec: acmeSpec({
      'x-docs': [
        {
          id: 'overview',
          title: 'Getting started',
          description: 'Start here.',
        },
        {
          title: 'Authorization',
          content: 'Keys live in the dashboard.',
        },
      ],
    }),
    plugins: [extractOverviewDocsPlugin()],
  });

  const items = pages(spec);
  assert.deepEqual(
    items.map((item) => item.id),
    ['overview', 'authorization', 'errors'],
  );
  const [overview, authorization] = items;
  assert.equal(overview.title, 'Getting started');
  assert.equal(overview.description, 'Start here.');
  assert.equal(overview.url, '/');
  assert.match(
    overview.content ?? '',
    /^# Getting started\n\nStart here\.\n\nAcme lets you ship\./,
  );
  assert.doesNotMatch(overview.content ?? '', /# Acme API/);
  assert.match(overview.content ?? '', /https:\/\/api\.acme\.dev/);
  assert.match(
    authorization.content ?? '',
    /^# Authorization\n\nKeys live in the dashboard\.\n\nThis API does not require authentication\./,
  );
  assert.deepEqual(diagnostics, []);
});

test('an authored x-docs entry without a generated match becomes its own page', async () => {
  const { spec, diagnostics } = await processSpec({
    spec: acmeSpec({
      'x-docs': [
        { title: 'Rate Limits & Quotas', content: '100 requests per minute.' },
        { title: 'Changelog', description: 'What changed and when.' },
      ],
    }),
    plugins: [extractOverviewDocsPlugin()],
  });

  const items = pages(spec);
  assert.deepEqual(
    items.map((item) => [item.id, item.url]),
    [
      ['overview', '/'],
      ['authorization', '/authorization'],
      ['errors', '/errors'],
      ['rate-limits-quotas', '/rate-limits-quotas'],
      ['changelog', '/changelog'],
    ],
  );
  assert.equal(items[3].title, 'Rate Limits & Quotas');
  assert.equal(items[3].content, '100 requests per minute.');
  assert.equal(items[4].content, 'What changed and when.');
  assert.match(items[0].content ?? '', /^# Acme API/);
  assert.deepEqual(diagnostics, []);
});

test('x-sdks renders an install box with a registry link per SDK', async () => {
  const sdks = [
    { language: 'typescript', package: '@acme/sdk' },
    { language: 'python', package: 'acme', url: 'https://acme.dev/python' },
    { language: 'dart', package: 'acme_sdk' },
  ];
  const { spec, diagnostics } = await processSpec({
    spec: acmeSpec({ 'x-sdks': sdks }),
    plugins: [extractOverviewDocsPlugin()],
  });

  const overview = pages(spec)[0].content ?? '';
  assert.match(overview, /## Official API Clients\n\n/);
  assert.match(
    overview,
    /Acme API provides official client SDKs for TypeScript, Python, and Dart\. Install one to get started:/,
  );
  assert.match(
    overview,
    /### TypeScript\n\n```bash\nnpm install @acme\/sdk\n```\n\n\[@acme\/sdk\]\(https:\/\/www\.npmjs\.com\/package\/@acme\/sdk\)/,
  );
  assert.match(
    overview,
    /### Python\n\n```bash\npip install acme\n```\n\n\[acme\]\(https:\/\/acme\.dev\/python\)/,
  );
  assert.match(
    overview,
    /### Dart\n\n```bash\ndart pub add acme_sdk\n```\n\n\[acme_sdk\]\(https:\/\/pub\.dev\/packages\/acme_sdk\)/,
  );
  assert.deepEqual(spec['x-sdks'], sdks);
  assert.deepEqual(diagnostics, []);
});

test('a single SDK reads in the singular', async () => {
  const { spec } = await processSpec({
    spec: acmeSpec({
      'x-sdks': [{ language: 'typescript', package: '@acme/sdk' }],
    }),
    plugins: [extractOverviewDocsPlugin()],
  });

  const overview = pages(spec)[0].content ?? '';
  assert.match(overview, /## Official API Client\n\n/);
  assert.match(
    overview,
    /Acme API provides an official client SDK for TypeScript\. Install it to get started:/,
  );
});

test('invalid, reserved, and duplicate entries are reported and skipped', async () => {
  const { spec, diagnostics } = await processSpec({
    spec: acmeSpec({
      'x-docs': [
        {},
        { title: 'embed' },
        { title: 'Guide', content: 'first' },
        { title: 'guide', content: 'second' },
        { title: 'Empty' },
        { title: '!!!', content: 'unreachable' },
      ],
      'x-sdks': [
        { language: 'go', package: 'acme' },
        { language: 'typescript', package: '@acme/sdk' },
      ],
    }),
    plugins: [extractOverviewDocsPlugin()],
  });

  assert.deepEqual(
    diagnostics.map((diagnostic) => [
      diagnostic.plugin,
      diagnostic.severity,
      diagnostic.code,
      diagnostic.path,
    ]),
    [
      ['extract-overview-docs', 'warning', 'invalid-x-sdks', '/x-sdks/0'],
      ['extract-overview-docs', 'warning', 'invalid-x-docs', '/x-docs/0'],
      ['extract-overview-docs', 'warning', 'reserved-x-docs-id', '/x-docs/1'],
      ['extract-overview-docs', 'warning', 'duplicate-x-docs-id', '/x-docs/3'],
      ['extract-overview-docs', 'warning', 'invalid-x-docs', '/x-docs/4'],
      ['extract-overview-docs', 'warning', 'invalid-x-docs', '/x-docs/5'],
    ],
  );
  assert.deepEqual(
    pages(spec).map((item) => item.id),
    ['overview', 'authorization', 'errors', 'guide'],
  );
  assert.equal(pages(spec)[3].content, 'first');
  assert.deepEqual(spec['x-sdks'], [
    { language: 'typescript', package: '@acme/sdk' },
  ]);
});

test('non-array x-docs and x-sdks are reported once and ignored', async () => {
  const { spec, diagnostics } = await processSpec({
    spec: acmeSpec({
      'x-docs': 'overview',
      'x-sdks': { language: 'typescript' },
    }),
    plugins: [extractOverviewDocsPlugin()],
  });

  assert.deepEqual(
    diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.path]),
    [
      ['invalid-x-sdks', '/x-sdks'],
      ['invalid-x-docs', '/x-docs'],
    ],
  );
  assert.deepEqual(
    pages(spec).map((item) => item.id),
    ['overview', 'authorization', 'errors'],
  );
  assert.deepEqual(spec['x-sdks'], []);
});

test('toSidebar leaves the IR untouched', async () => {
  const { spec } = await processSpec({
    spec: acmeSpec(),
    plugins: [extractOverviewDocsPlugin()],
  });

  const first = toSidebar(spec);
  const second = toSidebar(spec);

  assert.deepEqual(second, first);
  assert.equal(first.length, 2);
  assert.deepEqual(
    spec['x-docs'].map((category) => category.category),
    ['Overview'],
  );
});
