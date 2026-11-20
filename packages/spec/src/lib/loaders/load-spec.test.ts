import { HttpServer } from '@zukhruf/testing/http';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadSpec } from '@sdk-it/spec';

test('a spec URL that answers 404 rejects with a message naming the URL', async () => {
  await using server = await new HttpServer().start((_, response) => {
    response.writeHead(404);
    response.end('<html>Not Found</html>');
  });
  const url = `${server.origin}/missing/openapi.yaml`;

  await assert.rejects(loadSpec(url), (error: Error) =>
    error.message.includes(url),
  );
});

test('a spec URL with no known extension that serves YAML loads the parsed spec', async () => {
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

  const { spec } = await loadSpec(`${server.origin}/openapi`);

  assert.deepEqual(spec, {
    openapi: '3.1.0',
    info: { title: 'Pets', version: '1.0.0' },
    paths: {},
    $self: `${server.origin}/openapi`,
  });
});

test('a spec URL with no known extension that serves JSON loads the parsed spec', async () => {
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

  const { spec } = await loadSpec(`${server.origin}/openapi`);

  assert.deepEqual(spec, {
    openapi: '3.1.0',
    info: { title: 'Pets', version: '1.0.0' },
    paths: {},
    $self: `${server.origin}/openapi`,
  });
});
