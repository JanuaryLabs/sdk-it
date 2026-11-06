import { TemporaryFiles } from '@zukhruf/testing/fs';
import { test } from '@zukhruf/testing/node';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { OpenAPIObject } from 'openapi3-ts/oas31';

import { generate } from '@sdk-it/dart';

void test('each request body content type selects its dispatcher call', async () => {
  await using workspace = await new TemporaryFiles().directory(
    'sdk-it-dart-content-types-',
  );
  const output = join(workspace.path, 'client');
  const operations = [
    ['sendJson', 'application/json', 'json'],
    ['sendFormdata', 'multipart/form-data', 'formdata'],
    ['sendUrlencoded', 'application/x-www-form-urlencoded', 'urlencoded'],
    ['sendOctetStream', 'application/octet-stream', 'binary'],
    ['sendPng', 'image/png', 'binary'],
    ['sendJsonCharset', 'application/json; charset=utf-8', 'json'],
  ] as const;
  const spec: OpenAPIObject = {
    openapi: '3.1.0',
    info: { title: 'Uploads API', version: '1.0.0' },
    paths: Object.fromEntries(
      operations.map(([operationId, contentType]) => [
        `/${operationId}`,
        {
          post: {
            operationId,
            tags: ['uploads'],
            requestBody: {
              required: true,
              content: {
                [contentType]: {
                  schema: {
                    type: 'object',
                    properties: { name: { type: 'string' } },
                    required: ['name'],
                  },
                },
              },
            },
            responses: { '204': { description: 'Sent' } },
          },
        },
      ]),
    ),
  };

  await generate(spec, { output, mode: 'minimal' });

  const client = await readFile(join(output, 'lib/api/uploads.dart'), 'utf8');
  assert.deepEqual(
    operations.map(([operationId]) => [
      operationId,
      dispatcherCallOf(client, operationId),
    ]),
    operations.map(([operationId, , kind]) => [operationId, kind]),
  );
});

void test('a content type with a parameter that has no value generates a json call', async () => {
  await using workspace = await new TemporaryFiles().directory(
    'sdk-it-dart-loose-content-type-',
  );
  const output = join(workspace.path, 'client');
  const spec: OpenAPIObject = {
    openapi: '3.1.0',
    info: { title: 'Notes API', version: '1.0.0' },
    paths: {
      '/notes': {
        post: {
          operationId: 'createNote',
          tags: ['notes'],
          requestBody: {
            required: true,
            content: {
              'application/json; charset': {
                schema: {
                  type: 'object',
                  properties: { title: { type: 'string' } },
                  required: ['title'],
                },
              },
            },
          },
          responses: { '204': { description: 'Created' } },
        },
      },
    },
  };

  await generate(spec, { output, mode: 'minimal' });

  const client = await readFile(join(output, 'lib/api/notes.dart'), 'utf8');
  assert.equal(dispatcherCallOf(client, 'createNote'), 'json');
});

function dispatcherCallOf(client: string, method: string) {
  const body = client
    .split(/\bFuture</)
    .find((part) => new RegExp(`^[^(]*\\s${method}\\(`).test(part));
  assert.ok(body, `method ${method} not found in:\n${client}`);
  return /this\.dispatcher\.(\w+)\(/.exec(body)?.[1];
}
