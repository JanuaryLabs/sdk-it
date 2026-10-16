import { test } from '@zukhruf/testing/node';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempDisposable, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import manifest from '@sdk-it/cli/package.json' with { type: 'json' };

void test.each(
  [
    {
      name: 'TypeScript minimal',
      language: 'typescript',
      options: [
        '--mode',
        'minimal',
        '--no-default-formatter',
        '--readme',
        'false',
      ],
      formattedDirectory: '.',
      installs: false,
    },
    {
      name: 'TypeScript full',
      language: 'typescript',
      options: [
        '--mode',
        'full',
        '--no-default-formatter',
        '--readme',
        'false',
      ],
      formattedDirectory: 'src',
      installs: true,
    },
    {
      name: 'Python',
      language: 'python',
      options: [],
      formattedDirectory: '.',
      installs: false,
    },
    {
      name: 'Dart',
      language: 'dart',
      options: [],
      formattedDirectory: 'lib',
      installs: false,
    },
  ] as const,
  (generator) =>
    test.each([0, 7, 'missing'] as const, (exitCode) =>
      test(`${generator.name} CLI handles custom formatter result ${exitCode}`, async () => {
        await using workspace = await mkdtempDisposable(
          join(tmpdir(), 'sdk-it-formatter-'),
        );
        const spec = join(workspace.path, 'openapi.json');
        const output = join(workspace.path, 'client');
        const formatter = join(workspace.path, 'formatter.mjs');
        await writeFile(
          spec,
          JSON.stringify({
            openapi: '3.1.0',
            info: { title: 'Formatter', version: '1.0.0' },
            paths: {
              '/ping': {
                get: {
                  operationId: 'ping',
                  responses: {
                    '200': {
                      description: 'Pong',
                      content: {
                        'application/json': { schema: { type: 'string' } },
                      },
                    },
                  },
                },
              },
            },
          }),
        );
        await writeFile(
          formatter,
          `
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
await setTimeout(150);
await writeFile(join(process.env.SDK_IT_OUTPUT, 'formatted.txt'), 'formatted');
if (${JSON.stringify(exitCode)}) console.error('formatter rejected the generated code');
process.exitCode = ${JSON.stringify(exitCode)};
`,
        );
        // The installer is an external command fixture: no registry or network access.
        await writeFile(
          join(workspace.path, 'npm'),
          `#!${process.execPath}
const { readFileSync, writeFileSync } = require('node:fs');
writeFileSync('installed.txt', readFileSync('src/formatted.txt', 'utf8'));
`,
          { mode: 0o755 },
        );

        const result = spawnSync(
          process.execPath,
          [
            fileURLToPath(
              new URL(
                manifest.bin['sdk-it'],
                import.meta.resolve('@sdk-it/cli/package.json'),
              ),
            ),
            'generate',
            generator.language,
            '--spec',
            spec,
            '--output',
            output,
            ...generator.options,
            '--formatter',
            exitCode === 'missing'
              ? join(workspace.path, 'missing-formatter')
              : `${process.execPath} ${formatter}`,
          ],
          {
            cwd: workspace.path,
            env: {
              ...process.env,
              PATH: `${workspace.path}${delimiter}${process.env.PATH}`,
            },
            encoding: 'utf8',
          },
        );

        assert.equal(result.error, undefined);
        assert.equal(result.signal, null);
        if (exitCode === 0) {
          assert.equal(result.status, 0, result.stderr);
          assert.equal(
            await readFile(
              join(output, generator.formattedDirectory, 'formatted.txt'),
              'utf8',
            ),
            'formatted',
          );
          if (generator.installs)
            assert.equal(
              await readFile(join(output, 'installed.txt'), 'utf8'),
              'formatted',
            );
        } else {
          assert.notEqual(
            result.status,
            0,
            'formatter failure must fail generation',
          );
          assert.match(
            result.stderr,
            exitCode === 'missing'
              ? /ENOENT/
              : /formatter rejected the generated code/,
          );
          if (exitCode === 'missing')
            assert.match(result.stderr, /missing-formatter/);
          await assert.rejects(readFile(join(output, 'installed.txt')), {
            code: 'ENOENT',
          });
        }
      }),
    ),
);
