import assert from 'node:assert/strict';
import { test } from 'node:test';

import { type IR, toIR, toSidebar } from '@sdk-it/spec';

/** Each sidebar section after the documentation pages, with its items' titles. */
function sections(ir: IR) {
  const docs = new Set(ir['x-docs'].map((category) => category.category));
  return toSidebar(ir)
    .filter((category) => !docs.has(category.category))
    .map((category) => [
      category.category,
      category.items.map((item) => item.title),
    ]);
}

test('every renamed operation tag keeps its definition, the authored name becoming its summary', async () => {
  const ir = await toIR({
    spec: {
      openapi: '3.2.0',
      info: { title: 'Accounts', version: '1.0.0' },
      tags: [
        { name: 'User Profiles', description: 'Profiles of users' },
        { name: '2fa', description: 'Two factor' },
        { name: 'billing', description: 'Invoices' },
        { name: 'Audit Log', summary: 'Audit' },
      ],
      paths: {
        '/profiles': {
          get: {
            operationId: 'listProfiles',
            tags: ['User Profiles'],
            responses: { '204': { description: 'Listed' } },
          },
        },
        '/2fa': {
          post: {
            operationId: 'enableTwoFactor',
            tags: ['2fa'],
            responses: { '204': { description: 'Enabled' } },
          },
        },
        '/invoices': {
          get: {
            operationId: 'listInvoices',
            tags: ['billing'],
            responses: { '204': { description: 'Listed' } },
          },
        },
        '/audit': {
          get: {
            operationId: 'listAudit',
            tags: ['Audit Log'],
            responses: { '204': { description: 'Listed' } },
          },
        },
      },
    },
  });

  assert.deepStrictEqual(ir.tags, [
    {
      name: 'user_profiles',
      description: 'Profiles of users',
      summary: 'User Profiles',
    },
    { name: '_2fa', description: 'Two factor', summary: '2fa' },
    { name: 'billing', description: 'Invoices' },
    { name: 'audit_log', summary: 'Audit' },
  ]);
});

test('an operation with no tag gets a definition for the group it is placed in', async () => {
  const ir = await toIR({
    spec: {
      openapi: '3.2.0',
      info: { title: 'Accounts', version: '1.0.0' },
      paths: {
        '/health': {
          get: {
            operationId: 'checkHealth',
            responses: { '204': { description: 'Healthy' } },
          },
        },
      },
    },
  });

  const [group] = ir.paths['/health']?.get?.tags ?? [];
  assert.ok(group);
  assert.deepStrictEqual(ir.tags, [{ name: group }]);
});

test('an operation tag with no authored definition gets one whose summary is the authored name', async () => {
  const ir = await toIR({
    spec: {
      openapi: '3.2.0',
      info: { title: 'Accounts', version: '1.0.0' },
      paths: {
        '/things': {
          get: {
            operationId: 'listThings',
            tags: ['Foo Bar'],
            responses: { '204': { description: 'Listed' } },
          },
        },
      },
    },
  });

  assert.deepStrictEqual(ir.tags, [{ name: 'foo_bar', summary: 'Foo Bar' }]);
});

test("the sidebar lists a spaced tag's operations under its authored name", async () => {
  const ir = await toIR({
    spec: {
      openapi: '3.2.0',
      info: { title: 'Accounts', version: '1.0.0' },
      tags: [{ name: 'User Profiles', description: 'Profiles of users' }],
      paths: {
        '/profiles': {
          get: {
            operationId: 'listProfiles',
            summary: 'List profiles',
            tags: ['User Profiles'],
            responses: { '204': { description: 'Listed' } },
          },
        },
      },
    },
  });

  const api = toSidebar(ir).find((category) => category.category === 'API');
  const [profiles] = api?.items ?? [];
  assert.equal(profiles?.title, 'User Profiles');
  assert.deepStrictEqual(
    profiles?.items?.map((item) => item.title),
    ['List profiles'],
  );
});

test('the sidebar lists every operation of a document that defines no tags', async () => {
  const ir = await toIR({
    spec: {
      openapi: '3.2.0',
      info: { title: 'Accounts', version: '1.0.0' },
      paths: {
        '/things': {
          get: {
            operationId: 'listThings',
            summary: 'List things',
            tags: ['Things'],
            responses: { '204': { description: 'Listed' } },
          },
        },
        '/health': {
          get: {
            operationId: 'checkHealth',
            summary: 'Check health',
            responses: { '204': { description: 'Healthy' } },
          },
        },
      },
    },
  });

  const api = toSidebar(ir).find((category) => category.category === 'API');
  assert.deepStrictEqual(
    api?.items.flatMap((item) => item.items?.map((child) => child.title)),
    ['List things', 'Check health'],
  );
});

test("a tag nested under a parent sits in its top-most ancestor's sidebar section, and a renamed parent's children follow it", async () => {
  const ir = await toIR({
    spec: {
      openapi: '3.2.0',
      info: { title: 'Accounts', version: '1.0.0' },
      tags: [
        { name: 'Accounts', summary: 'Your accounts', kind: 'nav' },
        { name: 'User Profiles', parent: 'Accounts' },
        { name: 'Admin Tools' },
        { name: 'Audit Log', parent: 'Admin Tools' },
      ],
      paths: {
        '/profiles': {
          get: {
            operationId: 'listProfiles',
            tags: ['User Profiles'],
            responses: { '204': { description: 'Listed' } },
          },
        },
        '/tools': {
          post: {
            operationId: 'runTool',
            tags: ['Admin Tools'],
            responses: { '204': { description: 'Ran' } },
          },
        },
        '/audit': {
          get: {
            operationId: 'listAudit',
            tags: ['Audit Log'],
            responses: { '204': { description: 'Listed' } },
          },
        },
      },
    },
  });

  assert.deepStrictEqual(
    ir.tags.map((tag) => [tag.name, tag.parent]),
    [
      ['Accounts', undefined],
      ['user_profiles', 'Accounts'],
      ['admin_tools', undefined],
      ['audit_log', 'admin_tools'],
    ],
  );
  assert.deepStrictEqual(sections(ir), [
    ['Your accounts', ['User Profiles']],
    ['API', ['Admin Tools']],
    ['Admin Tools', ['Audit Log']],
  ]);
});

test('two authored definitions that name one group become one definition, the first one kept', async () => {
  const ir = await toIR({
    spec: {
      openapi: '3.2.0',
      info: { title: 'Accounts', version: '1.0.0' },
      tags: [
        { name: 'User Profiles', description: 'First' },
        { name: 'user_profiles', description: 'Second' },
      ],
      paths: {
        '/profiles': {
          get: {
            operationId: 'listProfiles',
            tags: ['User Profiles'],
            responses: { '204': { description: 'Listed' } },
          },
        },
      },
    },
  });

  assert.deepStrictEqual(ir.tags, [
    {
      name: 'user_profiles',
      description: 'First',
      summary: 'User Profiles',
    },
  ]);
});

test("the sidebar puts a grandchild in its top-most ancestor's section, a tag whose parent names no tag in the API section, and ends a parent cycle", async () => {
  const listed = { '204': { description: 'Listed' } };
  const ir = await toIR({
    spec: {
      openapi: '3.2.0',
      info: { title: 'Accounts', version: '1.0.0' },
      tags: [
        { name: 'Root', summary: 'Root section', description: 'Root pages' },
        { name: 'Mid', parent: 'Root' },
        { name: 'Leaf', parent: 'Mid' },
        { name: 'Orphan', parent: 'Missing' },
        { name: 'Ping', parent: 'Pong' },
        { name: 'Pong', parent: 'Ping' },
      ],
      paths: {
        '/leaf': {
          get: { operationId: 'getLeaf', tags: ['Leaf'], responses: listed },
        },
        '/orphan': {
          get: {
            operationId: 'getOrphan',
            tags: ['Orphan'],
            responses: listed,
          },
        },
        '/ping': {
          get: { operationId: 'getPing', tags: ['Ping'], responses: listed },
        },
        '/pong': {
          get: { operationId: 'getPong', tags: ['Pong'], responses: listed },
        },
      },
    },
  });

  assert.deepStrictEqual(sections(ir), [
    ['Root section', ['Leaf']],
    ['API', ['Orphan']],
    ['Pong', ['Ping']],
    ['Ping', ['Pong']],
  ]);
  const root = toSidebar(ir).find(
    (category) => category.category === 'Root section',
  );
  assert.equal(root?.id, 'root');
  assert.equal(root?.description, 'Root pages');
});
