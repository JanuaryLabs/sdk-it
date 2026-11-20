import { TemporaryFiles } from '@zukhruf/fs';
import { HttpServer } from '@zukhruf/testing/http';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

import { DocumentParseError, loadSpec } from '@sdk-it/spec';

test('a local spec file with no known extension loads as YAML', async () => {
  await using dir = await new TemporaryFiles().directory('sdk-it-load-spec-');
  const file = join(dir.path, 'api.openapi');
  await writeFile(
    file,
    [
      'openapi: 3.1.0',
      'info: { title: Pets, version: 1.0.0 }',
      'paths: {}',
    ].join('\n'),
  );

  const { spec } = await loadSpec(file);

  assert.deepEqual(spec, {
    openapi: '3.1.0',
    info: { title: 'Pets', version: '1.0.0' },
    paths: {},
    $self: pathToFileURL(file).href,
  });
});

test('a .json spec file whose text is not JSON rejects with a DocumentParseError naming the file', async () => {
  await using dir = await new TemporaryFiles().directory('sdk-it-load-spec-');
  const file = join(dir.path, 'openapi.json');
  await writeFile(file, '{ "openapi": ');

  await assert.rejects(
    loadSpec(file),
    (error: Error) =>
      error instanceof DocumentParseError &&
      error.message.includes(pathToFileURL(file).href),
  );
});

test('a spec file that holds a YAML list rejects with a DocumentParseError naming the file', async () => {
  await using dir = await new TemporaryFiles().directory('sdk-it-load-spec-');
  const file = join(dir.path, 'openapi.yaml');
  await writeFile(file, '- openapi: 3.1.0\n');

  await assert.rejects(
    loadSpec(file),
    (error: Error) =>
      error instanceof DocumentParseError &&
      error.message.includes(pathToFileURL(file).href),
  );
});

test('a .json spec file is read as JSON only, so YAML text in it rejects with a DocumentParseError', async () => {
  await using dir = await new TemporaryFiles().directory('sdk-it-load-spec-');
  const file = join(dir.path, 'openapi.json');
  await writeFile(
    file,
    [
      'openapi: 3.1.0',
      'info: { title: Pets, version: 1.0.0 }',
      'paths: {}',
    ].join('\n'),
  );

  await assert.rejects(
    loadSpec(file),
    (error: Error) =>
      error instanceof DocumentParseError &&
      error.message.includes(pathToFileURL(file).href),
  );
});

test('a spec URL with no known extension whose text is neither JSON nor YAML rejects with a DocumentParseError naming the URL', async () => {
  await using server = await new HttpServer().start((_, response) => {
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end('{ "openapi": ');
  });
  const url = `${server.origin}/openapi`;

  await assert.rejects(
    loadSpec(url),
    (error: Error) =>
      error instanceof DocumentParseError && error.message.includes(url),
  );
});

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

test('a spec URL that serves an HTML page rejects with a DocumentParseError naming the URL', async () => {
  await using server = await new HttpServer().start((_, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<html><body>Sign in to continue</body></html>');
  });
  const url = `${server.origin}/openapi`;

  await assert.rejects(
    loadSpec(url),
    (error: Error) =>
      error instanceof DocumentParseError && error.message.includes(url),
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
