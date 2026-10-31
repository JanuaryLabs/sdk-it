import { API } from '@typescript/native/sync';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';

import {
  openAnalysisProject,
  preEmitDiagnostics,
  sourceFiles,
} from '@sdk-it/core/program.js';

async function writeProject(files: Record<string, string>) {
  const dir = await realpath(
    await mkdtemp(join(tmpdir(), 'sdk-it-program-test-')),
  );
  for (const [file, content] of Object.entries(files)) {
    await mkdir(dirname(join(dir, file)), { recursive: true });
    await writeFile(join(dir, file), content);
  }
  return dir;
}

describe('preEmitDiagnostics', () => {
  test('reports every diagnostic exactly once', async () => {
    const dir = await writeProject({
      'tsconfig.json': JSON.stringify({
        compilerOptions: { strict: true, emitDeclarationOnly: true },
        include: ['src'],
      }),
      'src/index.ts': 'let target = { a: 1 };\ndelete target;\nexport {};\n',
    });
    try {
      using api = new API();
      const parsed = api.parseConfigFile(join(dir, 'tsconfig.json'));
      using program = api.createProgram(parsed.fileNames, parsed.options, {
        configFileParsingDiagnostics: parsed.errors,
      });

      const codes = preEmitDiagnostics(program).map(({ code }) => code);

      assert.deepStrictEqual(codes.toSorted(), [1102, 2703, 5069]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('openAnalysisProject', () => {
  test('rejects a tsconfig that does not parse and names it', async () => {
    const dir = await writeProject({
      'tsconfig.json': JSON.stringify({
        compilerOptions: { notAnOption: true },
      }),
      'index.ts': 'export {};\n',
    });
    try {
      assert.throws(
        () => openAnalysisProject(join(dir, 'tsconfig.json')),
        (error: Error) => {
          assert.match(error.message, /^Failed to parse .*tsconfig\.json/);
          assert.match(error.message, /notAnOption/);
          return true;
        },
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('resolves packages through their @sdk-it/source export condition', async () => {
    const dir = await writeProject({
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
    try {
      using project = openAnalysisProject(join(dir, 'tsconfig.json'));

      const fileNames: readonly string[] = project.program.getSourceFileNames();

      assert.ok(fileNames.includes(join(dir, 'node_modules/lib/src/index.ts')));
      assert.ok(
        !fileNames.includes(join(dir, 'node_modules/lib/dist/index.d.ts')),
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('sourceFiles', () => {
  test('yields the program source files without declaration files', async () => {
    const dir = await writeProject({
      'tsconfig.json': JSON.stringify({
        compilerOptions: { strict: true },
        include: ['src'],
      }),
      'src/routes.ts': 'export const routes = 1;\n',
      'src/env.d.ts': 'declare const ENV: string;\n',
    });
    try {
      using project = openAnalysisProject(join(dir, 'tsconfig.json'));

      const fileNames = [...sourceFiles(project.program)].map(
        ({ fileName }) => fileName,
      );

      assert.deepStrictEqual(fileNames, [join(dir, 'src/routes.ts')]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
