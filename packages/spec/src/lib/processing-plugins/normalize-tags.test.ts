import assert from 'node:assert/strict';
import { test } from 'node:test';

import { toIR, toSidebar } from '@sdk-it/spec';

test('every renamed operation tag keeps its definition and tag group entry, the authored name becoming its display name', async () => {
  const ir = await toIR({
    spec: {
      openapi: '3.1.0',
      info: { title: 'Accounts', version: '1.0.0' },
      tags: [
        { name: 'User Profiles', description: 'Profiles of users' },
        { name: '2fa', description: 'Two factor' },
        { name: 'billing', description: 'Invoices' },
        { name: 'Audit Log', 'x-displayName': 'Audit' },
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
      'x-displayName': 'User Profiles',
    },
    { name: '_2fa', description: 'Two factor', 'x-displayName': '2fa' },
    { name: 'billing', description: 'Invoices' },
    { name: 'audit_log', 'x-displayName': 'Audit' },
  ]);
  assert.deepStrictEqual(ir['x-tagGroups'], [
    { name: 'API', tags: ['user_profiles', '_2fa', 'billing', 'audit_log'] },
  ]);
});

test('an operation with no tag gets a definition for the group it is placed in', async () => {
  const ir = await toIR({
    spec: {
      openapi: '3.1.0',
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

test('an operation tag with no authored definition gets one that displays the authored name', async () => {
  const ir = await toIR({
    spec: {
      openapi: '3.1.0',
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

  assert.deepStrictEqual(ir.tags, [
    { name: 'foo_bar', 'x-displayName': 'Foo Bar' },
  ]);
});

test("the sidebar lists a spaced tag's operations under its authored name", async () => {
  const ir = await toIR({
    spec: {
      openapi: '3.1.0',
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

test("an authored tag group's entries take their operations' group names, so the sidebar lists that group's operations", async () => {
  const ir = await toIR({
    spec: {
      openapi: '3.1.0',
      info: { title: 'Accounts', version: '1.0.0' },
      tags: [{ name: 'User Profiles', description: 'Profiles of users' }],
      'x-tagGroups': [{ name: 'Core', tags: ['User Profiles'] }],
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

  assert.deepStrictEqual(ir['x-tagGroups'], [
    { name: 'Core', tags: ['user_profiles'] },
  ]);
  const core = toSidebar(ir).find((category) => category.category === 'Core');
  const [profiles] = core?.items ?? [];
  assert.deepStrictEqual(
    profiles?.items?.map((item) => item.title),
    ['List profiles'],
  );
});

test('two authored definitions that name one group become one definition, the first one kept', async () => {
  const ir = await toIR({
    spec: {
      openapi: '3.1.0',
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
      'x-displayName': 'User Profiles',
    },
  ]);
});
