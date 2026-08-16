import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SecurityRequirementObject } from 'openapi3-ts/oas31';

import { normalizeSecurity, processSpec } from '@sdk-it/spec';

test('materializes effective operation security without losing AND, OR, or anonymous access', async () => {
  const rootSecurity: SecurityRequirementObject[] = [
    { mtls: [], oauth: ['records:read'] },
    { oidc: ['openid'] },
    {},
  ];
  const { spec } = await processSpec({
    spec: {
      openapi: '3.2.0',
      info: { title: 'Security', version: '1.0.0' },
      security: rootSecurity,
      components: {
        securitySchemes: {
          mtls: { type: 'mutualTLS' },
          oauth: {
            type: 'oauth2',
            oauth2MetadataUrl:
              'https://auth.example.com/.well-known/oauth-authorization-server',
            flows: {
              deviceAuthorization: {
                deviceAuthorizationUrl: 'https://auth.example.com/device',
                tokenUrl: 'https://auth.example.com/token',
                scopes: { 'records:read': 'Read records' },
              },
            },
          },
          oidc: {
            type: 'openIdConnect',
            openIdConnectUrl:
              'https://auth.example.com/.well-known/openid-configuration',
          },
        },
      },
      paths: {
        '/inherited': {
          get: { responses: { '204': { description: 'OK' } } },
        },
        '/public': {
          get: {
            security: [],
            responses: { '204': { description: 'OK' } },
          },
        },
        '/optional': {
          get: {
            security: [{}, { oidc: ['openid', 'profile'] }],
            responses: { '204': { description: 'OK' } },
          },
        },
      },
    },
    plugins: [normalizeSecurity()],
  });

  assert.deepStrictEqual(
    Object.fromEntries(
      Object.entries(spec.paths).map(([path, item]) => [
        path,
        item?.get?.security,
      ]),
    ),
    {
      '/inherited': rootSecurity,
      '/public': [],
      '/optional': [{}, { oidc: ['openid', 'profile'] }],
    },
  );
});

test('reports invalid OAuth scopes, conflicting AND credential targets, and unresolved schemes', async () => {
  const { diagnostics } = await processSpec({
    spec: {
      openapi: '3.1.0',
      info: { title: 'Security diagnostics', version: '1.0.0' },
      components: {
        securitySchemes: {
          oauth: {
            type: 'oauth2',
            flows: {
              clientCredentials: {
                tokenUrl: 'https://auth.example.com/token',
                scopes: { 'records:read': 'Read records' },
              },
            },
          },
          firstKey: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
          secondKey: { type: 'apiKey', in: 'header', name: 'x-api-key' },
        },
      },
      paths: {
        '/records': {
          get: {
            security: [
              { oauth: ['records:write'] },
              { firstKey: [], secondKey: [] },
              { 'https://auth.example.com/security': ['external-role'] },
            ],
            responses: { '204': { description: 'OK' } },
          },
        },
      },
    },
    plugins: [normalizeSecurity()],
  });

  assert.deepStrictEqual(
    diagnostics.map(({ code, path, severity }) => ({
      code,
      path,
      severity,
    })),
    [
      {
        code: 'unknown-oauth-scope',
        path: 'GET /records',
        severity: 'error',
      },
      {
        code: 'conflicting-security-target',
        path: 'GET /records',
        severity: 'error',
      },
      {
        code: 'unresolved-security-scheme',
        path: 'GET /records',
        severity: 'error',
      },
    ],
  );
});

test('reports malformed security scheme fixed fields', async () => {
  const { diagnostics } = await processSpec({
    spec: {
      openapi: '3.2.0',
      info: { title: 'Invalid schemes', version: '1.0.0' },
      components: {
        securitySchemes: {
          badApiKey: { type: 'apiKey', in: 'header' },
          badHttp: { type: 'http', scheme: '' },
          badDeviceFlow: {
            type: 'oauth2',
            flows: {
              deviceAuthorization: {
                tokenUrl: 'https://auth.example.com/token',
                scopes: {},
              },
            },
          },
          badOidc: { type: 'openIdConnect' },
        },
      },
      paths: {},
    } as never,
    plugins: [normalizeSecurity()],
  });

  assert.deepStrictEqual(
    diagnostics.map(({ code, path }) => ({ code, path })),
    [
      {
        code: 'invalid-security-scheme',
        path: 'components.securitySchemes.badApiKey',
      },
      {
        code: 'invalid-security-scheme',
        path: 'components.securitySchemes.badHttp',
      },
      {
        code: 'invalid-security-scheme',
        path: 'components.securitySchemes.badDeviceFlow',
      },
      {
        code: 'invalid-security-scheme',
        path: 'components.securitySchemes.badOidc',
      },
    ],
  );
});
