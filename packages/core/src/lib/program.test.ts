import { API } from '@typescript/native/sync';
import { TemporaryFiles } from '@zukhruf/testing/fs';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import { promisify } from 'node:util';

import {
  openAnalysisProject,
  preEmitDiagnostics,
  sourceFiles,
} from '@sdk-it/core/program.js';

const execFileAsync = promisify(execFile);
const tsc = join(
  dirname(
    createRequire(import.meta.url).resolve('@typescript/native/package.json'),
  ),
  'bin/tsc',
);

async function writeProject(files: Record<string, string>) {
  await using pending = new AsyncDisposableStack();
  const workspace = pending.use(
    await new TemporaryFiles().directory('sdk-it-program-test-'),
  );
  for (const [file, content] of Object.entries(files)) {
    await mkdir(dirname(join(workspace.path, file)), { recursive: true });
    await writeFile(join(workspace.path, file), content);
  }
  pending.move();
  return workspace;
}

describe('preEmitDiagnostics', () => {
  test('reports every diagnostic exactly once', async () => {
    await using workspace = await writeProject({
      'tsconfig.json': JSON.stringify({
        compilerOptions: {
          strict: true,
          emitDeclarationOnly: true,
          notAnOption: true,
        },
        include: ['src'],
      }),
      'src/index.ts': 'let target = { a: 1 };\ndelete target;\nexport {};\n',
    });
    const dir = workspace.path;
    using api = new API();
    const parsed = api.parseConfigFile(join(dir, 'tsconfig.json'));
    using program = api.createProgram(parsed.fileNames, parsed.options, {
      configFileParsingDiagnostics: parsed.errors,
    });

    const codes = preEmitDiagnostics(program).map(({ code }) => code);

    assert.deepStrictEqual(codes.toSorted(), [1102, 2703, 5023, 5069]);
  });
});

describe('openAnalysisProject', () => {
  test('rejects a tsconfig that does not parse and names it', async () => {
    await using workspace = await writeProject({
      'tsconfig.json': JSON.stringify({
        compilerOptions: { notAnOption: true },
      }),
      'index.ts': 'export {};\n',
    });
    const dir = workspace.path;
    assert.throws(
      () => openAnalysisProject(join(dir, 'tsconfig.json')),
      (error: Error) => {
        assert.match(error.message, /^Failed to parse .*tsconfig\.json/);
        assert.match(error.message, /notAnOption/);
        return true;
      },
    );
  });

  test('resolves packages through their @sdk-it/source export condition', async () => {
    await using workspace = await writeProject({
      'tsconfig.json': JSON.stringify({
        compilerOptions: {
          module: 'esnext',
          moduleResolution: 'bundler',
          strict: true,
        },
        include: ['src'],
      }),
      'src/main.ts':
        "import { fromSource } from 'lib';\nexport { fromSource };\n",
      'node_modules/lib/package.json': JSON.stringify({
        name: 'lib',
        exports: {
          '.': {
            '@sdk-it/source': './src/index.ts',
            types: './dist/index.d.ts',
            default: './dist/index.js',
          },
        },
      }),
      'node_modules/lib/src/index.ts': 'export const fromSource = 1;\n',
      'node_modules/lib/dist/index.d.ts':
        'export declare const fromDeclarations: number;\n',
    });
    const dir = workspace.path;
    using project = openAnalysisProject(join(dir, 'tsconfig.json'));

    const fileNames: readonly string[] = project.program.getSourceFileNames();

    assert.ok(fileNames.includes(join(dir, 'node_modules/lib/src/index.ts')));
    assert.ok(
      !fileNames.includes(join(dir, 'node_modules/lib/dist/index.d.ts')),
    );
  });

  test('reads a referenced package as source when the tsconfig path goes through a symlink', async () => {
    const compilerOptions = {
      module: 'esnext',
      moduleResolution: 'bundler',
      strict: true,
      skipLibCheck: true,
    };
    await using workspace = await writeProject({
      'tsconfig.json': JSON.stringify({
        compilerOptions,
        include: ['src'],
        references: [{ path: './packages/runs' }],
      }),
      'src/main.ts': "import { ensureRun } from '@ws/runs';\nensureRun();\n",
      'packages/runs/package.json': JSON.stringify({
        name: '@ws/runs',
        type: 'module',
        exports: {
          '.': { types: './dist/index.d.ts', default: './dist/index.js' },
        },
      }),
      'packages/runs/tsconfig.json': JSON.stringify({
        compilerOptions: {
          ...compilerOptions,
          composite: true,
          declaration: true,
          rootDir: 'src',
          outDir: 'dist',
        },
        include: ['src'],
      }),
      'packages/runs/src/index.ts': 'export function ensureRun(): void {}\n',
    });
    const dir = workspace.path;
    await using links = await new TemporaryFiles().directory(
      'sdk-it-program-link-',
    );
    await mkdir(join(dir, 'node_modules/@ws'), { recursive: true });
    await symlink(
      join(dir, 'packages/runs'),
      join(dir, 'node_modules/@ws/runs'),
      'dir',
    );
    // The app imports the built declarations, as after the monorepo's build.
    await execFileAsync(process.execPath, [
      tsc,
      '--build',
      join(dir, 'packages/runs'),
    ]);
    const link = join(links.path, 'workspace');
    await symlink(dir, link, 'dir');

    using throughLink = openAnalysisProject(join(link, 'tsconfig.json'));
    using throughRealPath = openAnalysisProject(join(dir, 'tsconfig.json'));

    const fileNames: readonly string[] =
      throughLink.program.getSourceFileNames();
    assert.ok(fileNames.includes(join(dir, 'packages/runs/src/index.ts')));
    assert.ok(
      !fileNames.some((name) => name.endsWith('packages/runs/dist/index.d.ts')),
    );
    assert.deepStrictEqual(
      [...fileNames].sort(),
      [...throughRealPath.program.getSourceFileNames()].sort(),
    );
  });

  test('a missing tsconfig fails with an error that names it', async () => {
    await using workspace = await new TemporaryFiles().directory(
      'sdk-it-program-missing-',
    );
    const dir = workspace.path;
    const missing = join(dir, 'app', 'tsconfig.json');

    assert.throws(() => openAnalysisProject(missing), {
      message: `Failed to read ${missing}: the file does not exist`,
    });
  });

  test('names the tsconfig as the caller passed it when it does not parse', async () => {
    await using workspace = await writeProject({
      'tsconfig.json': JSON.stringify({
        compilerOptions: { notAnOption: true },
      }),
      'index.ts': 'export {};\n',
    });
    const dir = workspace.path;
    await using links = await new TemporaryFiles().directory(
      'sdk-it-program-link-',
    );
    const link = join(links.path, 'workspace');
    await symlink(dir, link, 'dir');
    const passed = join(link, 'tsconfig.json');

    assert.throws(
      () => openAnalysisProject(passed),
      (error: Error) => error.message.startsWith(`Failed to parse ${passed}:`),
    );
  });
});

describe('sourceFiles', () => {
  test('yields the program source files without declaration files', async () => {
    await using workspace = await writeProject({
      'tsconfig.json': JSON.stringify({
        compilerOptions: { strict: true },
        include: ['src'],
      }),
      'src/routes.ts': 'export const routes = 1;\n',
      'src/env.d.ts': 'declare const ENV: string;\n',
    });
    const dir = workspace.path;
    using project = openAnalysisProject(join(dir, 'tsconfig.json'));

    const fileNames = [...sourceFiles(project.program)].map(
      ({ fileName }) => fileName,
    );

    assert.deepStrictEqual(fileNames, [join(dir, 'src/routes.ts')]);
  });
});
