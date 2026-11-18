import { HttpServer } from '@zukhruf/testing/http';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { loadRemote } from '@sdk-it/spec';

describe('loadRemote', () => {
  test('a URL with no known extension that serves YAML resolves to the parsed document', async () => {
    await using server = await new HttpServer().start((_, response) => {
      response.writeHead(200, { 'content-type': 'application/yaml' });
      response.end(
        [
          'openapi: 3.1.0',
          'info:',
          '  title: Pets',
          '  version: 1.0.0',
          'paths: {}',
        ].join('\n'),
      );
    });

    const document = await loadRemote(`${server.origin}/openapi`);

    assert.deepEqual(document, {
      openapi: '3.1.0',
      info: { title: 'Pets', version: '1.0.0' },
      paths: {},
    });
  });

  test('a URL with no known extension that serves JSON resolves to the parsed document', async () => {
    await using server = await new HttpServer().start((_, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          openapi: '3.1.0',
          info: { title: 'Pets', version: '1.0.0' },
          paths: {},
        }),
      );
    });

    const document = await loadRemote(`${server.origin}/openapi`);

    assert.deepEqual(document, {
      openapi: '3.1.0',
      info: { title: 'Pets', version: '1.0.0' },
      paths: {},
    });
  });
});
