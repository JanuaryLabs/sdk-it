import { TemporaryFiles } from '@zukhruf/testing/fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

import { loader } from './root';

/** The TypeScript code sample the loader gives for a spec titled `title`. */
async function typescriptSample(title: string | undefined) {
  await using directory = await new TemporaryFiles().directory(
    'apiref-client-name-',
  );
  const specPath = join(directory.path, 'openapi.json');
  await writeFile(
    specPath,
    JSON.stringify({
      openapi: '3.1.0',
      info: { ...(title === undefined ? {} : { title }), version: '1.0.0' },
      servers: [{ url: 'https://api.example.com' }],
      paths: {
        '/books': {
          get: {
            operationId: 'listBooks',
            tags: ['books'],
            responses: { '204': { description: 'No Content' } },
          },
        },
      },
    }),
  );
  const url = new URL('http://localhost/');
  url.searchParams.set('spec', specPath);
  const { operationsMap } = await loader({
    request: new Request(url),
    params: {},
  });
  return operationsMap['listBooks'].entry.snippets.find(
    ({ language }) => language === 'TypeScript',
  )?.code;
}

describe('the TypeScript code sample', () => {
  test('names the client after the spec title in PascalCase', async () => {
    const code = await typescriptSample('Discord HTTP API (Preview)');

    expect(code).toContain('discordHttpApiPreview');
    expect(code).not.toMatch(/\bClient\b/);
  });

  test('keeps the capitals inside a mixed-case word of the title', async () => {
    expect(await typescriptSample('OpenStatus API')).toContain('openStatusApi');
  });

  test('prefixes Api to a title that starts with a digit', async () => {
    expect(await typescriptSample('2024 Events')).toContain('api2024Events');
  });

  test('refuses a spec without info.title', async () => {
    await expect(typescriptSample(undefined)).rejects.toThrow(/info\.title/);
  });
});
