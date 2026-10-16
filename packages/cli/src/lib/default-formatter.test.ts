import { test } from '@zukhruf/testing/node';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdir,
  mkdtempDisposable,
  readFile,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import manifest from '@sdk-it/cli/package.json' with { type: 'json' };

void test.each([false, true], (verbose) =>
  test.each(
    ['success', 'failure', 'cannot-start', 'disabled'] as const,
    (outcome) =>
      test(`TypeScript default formatter ${outcome}, verbose=${verbose}`, async () => {
        await using workspace = await mkdtempDisposable(
          join(tmpdir(), 'sdk-it-default-formatter-'),
        );
        const spec = join(workspace.path, 'openapi.json');
        const output = join(workspace.path, 'client');
        const source = join(output, 'src');
        const bin = join(workspace.path, 'node_modules', '.bin');
        await mkdir(bin, { recursive: true });
        await writeFile(
          spec,
          JSON.stringify({
            openapi: '3.1.0',
            info: { title: 'Formatter', version: '1.0.0' },
            paths: {},
          }),
        );
        if (outcome === 'cannot-start') {
          // A self-link makes process creation fail with ELOOP, before any npx can run.
          await symlink('npx', join(bin, 'npx'));
        } else {
          await writeFile(
            join(bin, 'npx'),
            `#!${process.execPath}
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const output = process.env.SDK_IT_OUTPUT;
readFileSync(join(output, 'client.ts'), 'utf8');
writeFileSync(join(output, 'arguments.json'), JSON.stringify(process.argv.slice(2)));
setTimeout(() => {
  console.log('fixture formatter output');
  if (${outcome === 'success'}) {
    writeFileSync(join(output, 'formatted.txt'), 'formatted');
  } else {
    console.error('default formatter rejected the generated code');
    process.exitCode = 7;
  }
}, 150);
`,
            { mode: 0o755 },
          );
        }
        // Local command fixtures keep the test independent of npm and the registry.
        await writeFile(
          join(workspace.path, 'npm'),
          `#!${process.execPath}
const { existsSync, readFileSync, writeFileSync } = require('node:fs');
writeFileSync('installed.txt', existsSync('src/formatted.txt') ? readFileSync('src/formatted.txt', 'utf8') : 'unformatted');
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
            'typescript',
            '--spec',
            spec,
            '--output',
            output,
            '--mode',
            'full',
            '--readme',
            'false',
            ...(verbose ? ['--verbose'] : []),
            ...(outcome === 'disabled' ? ['--no-default-formatter'] : []),
          ],
          {
            cwd: workspace.path,
            env: { ...process.env, PATH: workspace.path },
            encoding: 'utf8',
          },
        );

        assert.equal(result.error, undefined);
        assert.equal(result.signal, null);
        if (outcome === 'success' || outcome === 'disabled') {
          assert.equal(result.status, 0, result.stderr);
          assert.equal(
            await readFile(join(output, 'installed.txt'), 'utf8'),
            outcome === 'success' ? 'formatted' : 'unformatted',
          );
          if (outcome === 'success') {
            assert.deepEqual(
              JSON.parse(
                await readFile(join(source, 'arguments.json'), 'utf8'),
              ),
              ['-y', 'prettier', source, '--write'],
            );
            if (verbose)
              assert.match(result.stdout, /fixture formatter output/);
            else assert.doesNotMatch(result.stdout, /fixture formatter output/);
          } else {
            await assert.rejects(readFile(join(source, 'arguments.json')), {
              code: 'ENOENT',
            });
          }
        } else {
          assert.notEqual(
            result.status,
            0,
            'formatter errors must fail generation',
          );
          assert.match(
            result.stderr,
            outcome === 'failure'
              ? /default formatter rejected the generated code/
              : /ELOOP/,
          );
          await assert.rejects(readFile(join(output, 'installed.txt')), {
            code: 'ENOENT',
          });
        }
      }),
  ),
);
