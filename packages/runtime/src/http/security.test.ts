import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { type RequestConfig, createSecurityInterceptor } from '@sdk-it/runtime';

function requestConfig(): RequestConfig {
  return {
    url: new URL('https://api.test/pets'),
    init: { method: 'GET', headers: new Headers() },
  };
}

describe('createSecurityInterceptor', () => {
  test('applies the credential the way the scheme passed in describes it', async () => {
    const { before } = createSecurityInterceptor(
      [{ apiKey: [] }],
      { apiKey: 'secret' },
      { apiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key' } },
    );
    assert.ok(before);

    const config = await before(requestConfig());

    assert.equal(config.init.headers.get('X-API-Key'), 'secret');
  });

  test('refuses a requirement that names a scheme the schemes passed in lack', async () => {
    const { before } = createSecurityInterceptor(
      [{ partnerAuth: [] }],
      { partnerAuth: 'token' },
      {},
    );
    assert.ok(before);

    await assert.rejects(async () => before(requestConfig()), {
      message: 'Unsupported external security scheme: partnerAuth',
    });
  });
});
