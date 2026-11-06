import { TemporaryFiles } from '@zukhruf/testing/fs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { stripVTControlCharacters } from 'node:util';

import { generateProject, initializeProject } from '@sdk-it/cli';
import { workspaceDirectory } from '@sdk-it/testing';

const repoRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
);
const cliBin = join(repoRoot, 'packages', 'cli', 'dist', 'bin.js');

function runCli(cwd: string, ...args: string[]) {
  return spawnSync(process.execPath, [cliBin, ...args], {
    cwd,
    encoding: 'utf8',
  });
}

test('package exposes the sdk-it executable', () => {
  const manifest = JSON.parse(
    readFileSync(join(repoRoot, 'packages', 'cli', 'package.json'), 'utf8'),
  );

  assert.deepEqual(manifest.bin, { 'sdk-it': './dist/bin.js' });
});

test('help identifies sdk-it and exposes the nested generators', () => {
  const rootHelp = runCli(repoRoot, '--help');

  assert.equal(rootHelp.status, 0, rootHelp.stderr);
  assert.match(rootHelp.stdout, /^Usage: sdk-it /);
  assert.match(
    rootHelp.stdout,
    /generate \[options\]\s+Generate SDKs from configuration or OpenAPI/,
  );

  const typescriptHelp = runCli(repoRoot, 'generate', 'typescript', '--help');

  assert.equal(typescriptHelp.status, 0, typescriptHelp.stderr);
  assert.match(
    typescriptHelp.stdout,
    /^Usage: sdk-it generate typescript\|ts \[options\]/,
  );
  assert.match(typescriptHelp.stdout, /--spec <spec>/);
});

async function createHonoWorkspace() {
  await using pending = new AsyncDisposableStack();
  const directory = pending.use(await workspaceDirectory('sdk-it-project-'));
  const workspace = directory.path;

  mkdirSync(join(workspace, 'src'));
  writeFileSync(
    join(workspace, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        module: 'esnext',
        moduleResolution: 'bundler',
        skipLibCheck: true,
        target: 'esnext',
      },
      include: ['src/**/*.ts'],
    }),
  );
  writeFileSync(
    join(workspace, 'src', 'index.ts'),
    `
import { Hono } from 'hono';
import { z } from 'zod';
import { validate } from '@sdk-it/hono/runtime';

const app = new Hono();

/** @openapi listBooks @tags books */
app.get(
  '/books',
  validate((payload) => ({
    author: {
      select: payload.query.author,
      against: z.string().optional(),
    },
  })),
  (context) => context.json([{ id: 'book-1', title: 'Type Systems' }]),
);
`,
  );

  pending.move();
  return {
    ...directory,
    output: join(workspace, '.sdk-it'),
    tsconfig: join(workspace, 'tsconfig.json'),
  };
}

async function createPrismaHonoWorkspace(
  options: { enumSchema?: boolean } = {},
) {
  const enumSchema = options.enumSchema ?? true;
  await using pending = new AsyncDisposableStack();
  const project = pending.use(await createHonoWorkspace());
  const generated = join(project.path, 'src', 'generated');
  mkdirSync(generated);
  writeFileSync(
    join(generated, 'client.d.ts'),
    `
export declare namespace Prisma {
  class Decimal {
    constructor(value: string);
  }
}

export declare const $Enums: {
  Status: {
    DRAFT: 'DRAFT';
    PUBLISHED: 'PUBLISHED';
  };
};

export type Product = {
  id: string;
  price: Prisma.Decimal;
};
`,
  );
  writeFileSync(
    join(generated, 'package.json'),
    JSON.stringify({ type: 'commonjs' }),
  );
  writeFileSync(
    join(generated, 'client.js'),
    `
exports.Prisma = {
  Decimal: class Decimal {
    constructor(value) {
      this.value = value;
    }
  },
};
exports.$Enums = {
  Status: {
    DRAFT: 'DRAFT',
    PUBLISHED: 'PUBLISHED',
  },
};
`,
  );
  writeFileSync(
    join(project.path, 'src', 'index.ts'),
    `
import { Hono } from 'hono';
import { z } from 'zod';
import { validate } from '@sdk-it/hono/runtime';
import { Prisma as DbPrisma, type Product } from './generated/client.js';
${enumSchema ? "import { $Enums } from './generated/client.js';" : ''}

const app = new Hono();

/** @openapi listBooks @tags books */
app.get(
  '/books',
  validate((payload) => ({
    author: {
      select: payload.query.author,
      against: z.string().optional(),
    },
    ${
      enumSchema
        ? `status: {
      select: payload.query.status,
      against: z.enum($Enums.Status),
    },`
        : ''
    }
  })),
  (context) => {
    const product: Product = {
      id: 'product-1',
      price: new DbPrisma.Decimal('19.99'),
    };
    return context.json(product);
  },
);
`,
  );
  pending.move();
  return project;
}

test('importing @sdk-it/cli does not run the command-line interface', () => {
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `import('@sdk-it/cli').then(({ defineConfig, generateProject }) => console.log(JSON.stringify({ defineConfig: typeof defineConfig, generateProject: typeof generateProject })))`,
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.stdout.trim(),
    '{"defineConfig":"function","generateProject":"function"}',
  );
});

test('generateProject creates a client from a Hono TypeScript project', async () => {
  await using project = await createHonoWorkspace();
  const { output, tsconfig } = project;
  await generateProject({
    tsconfig,
    output,
  });

  const endpoint = readFileSync(join(output, 'src', 'api', 'books.ts'), 'utf8');
  assert.match(endpoint, /"GET \/books"/);
});

test("generateProject detects Hono when framework is explicitly 'auto'", async () => {
  await using project = await createHonoWorkspace();
  const { output, tsconfig } = project;
  await generateProject({ tsconfig, output, framework: 'auto' });

  const endpoint = readFileSync(join(output, 'src', 'api', 'books.ts'), 'utf8');
  assert.match(endpoint, /"GET \/books"/);
});

test('generated project client is directly importable by Node.js', async () => {
  await using project = await createHonoWorkspace();
  await using consumer = await new TemporaryFiles().directory(
    'sdk-it-client-consumer-',
  );
  const output = join(consumer.path, 'client');
  mkdirSync(join(consumer.path, 'node_modules', '@sdk-it'), {
    recursive: true,
  });
  for (const dependency of ['fast-content-type-parse', 'zod']) {
    symlinkSync(
      join(repoRoot, 'node_modules', dependency),
      join(consumer.path, 'node_modules', dependency),
    );
  }
  await generateProject({ tsconfig: project.tsconfig, output });

  const manifest = JSON.parse(
    readFileSync(join(output, 'package.json'), 'utf8'),
  );
  assert.deepEqual(manifest.exports['.'], {
    types: './dist/index.d.ts',
    import: './dist/index.js',
    default: './dist/index.js',
  });

  symlinkSync(output, join(consumer.path, 'node_modules', '@sdk-it', 'client'));

  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `import('@sdk-it/client').then(({ Client }) => console.log(typeof Client))`,
    ],
    { cwd: consumer.path, encoding: 'utf8' },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'function');
});

test('loadProjectConfig finds a typed config and resolves its paths', async () => {
  await using project = await createHonoWorkspace();
  const { path: workspace } = project;
  writeFileSync(
    join(workspace, 'sdk-it.config.ts'),
    `
import { defineConfig } from '@sdk-it/cli';

export default defineConfig({
  tsconfig: './tsconfig.json',
  securitySchemes: {
    bearer: { type: 'http', scheme: 'bearer' },
  },
  middlewareSecurity: [{
    middleware: { import: 'authenticate', from: './src/auth.ts' },
    security: [{ bearer: [] }],
  }],
});
`,
  );

  const cli = await import('@sdk-it/cli');
  assert.equal(typeof cli.loadProjectConfig, 'function');

  const config = await cli.loadProjectConfig({
    cwd: join(workspace, 'src'),
  });
  assert.deepEqual(config, {
    tsconfig: join(workspace, 'tsconfig.json'),
    output: join(workspace, '.sdk-it'),
    securitySchemes: {
      bearer: { type: 'http', scheme: 'bearer' },
    },
    middlewareSecurity: [
      {
        middleware: {
          import: 'authenticate',
          from: join(workspace, 'src/auth.ts'),
        },
        security: [{ bearer: [] }],
      },
    ],
  });
});

test('sdk-it generate uses the project config through the CLI', async () => {
  await using project = await createHonoWorkspace();
  const { output, path: workspace } = project;
  writeFileSync(
    join(workspace, 'sdk-it.config.ts'),
    `
import { defineConfig } from '@sdk-it/cli';

export default defineConfig({
  tsconfig: './tsconfig.json',
});
`,
  );

  const result = runCli(workspace, 'generate');

  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(
    readFileSync(join(output, 'package.json'), 'utf8'),
  );
  assert.equal(manifest.exports['.'].import, './dist/index.js');
});

test('sdk-it generate accepts an explicit TypeScript config path', async () => {
  await using project = await createHonoWorkspace();
  const { path: workspace } = project;
  writeFileSync(
    join(workspace, 'backend-client.config.ts'),
    `
import { defineConfig } from '@sdk-it/cli';

export default defineConfig({
  tsconfig: './tsconfig.json',
  output: './generated-client',
});
`,
  );

  const result = runCli(
    workspace,
    'generate',
    '--config',
    'backend-client.config.ts',
  );

  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(
    readFileSync(join(workspace, 'generated-client', 'package.json'), 'utf8'),
  );
  assert.equal(manifest.name, '@sdk-it/client');
  assert.equal(manifest.exports['.'].import, './dist/index.js');
});

test('sdk-it init --project initializes a nested backend client workspace', async () => {
  await using monorepo = await workspaceDirectory('sdk-it-monorepo-');
  const workspace = monorepo.path;
  const project = join(workspace, 'apps', 'api');
  mkdirSync(join(project, 'src'), { recursive: true });
  writeFileSync(
    join(project, 'tsconfig.app.json'),
    JSON.stringify(
      {
        compilerOptions: {
          module: 'esnext',
          moduleResolution: 'bundler',
          skipLibCheck: true,
          target: 'esnext',
        },
        include: ['src/**/*.ts'],
      },
      null,
      2,
    ),
  );
  writeFileSync(
    join(project, 'src', 'index.ts'),
    `import { Hono } from 'hono';
import { z } from 'zod';
import { validate } from '@sdk-it/hono/runtime';

const app = new Hono();

/** @openapi listBooks @tags books */
app.get(
  '/books',
  validate((payload) => ({
    author: {
      select: payload.query.author,
      against: z.string().optional(),
    },
  })),
  (context) => context.json([{ id: 'book-1', title: 'Type Systems' }]),
);
`,
  );
  writeFileSync(
    join(workspace, 'package.json'),
    JSON.stringify(
      {
        name: '@acme/platform',
        private: true,
        workspaces: ['apps/*'],
      },
      null,
      2,
    ),
  );
  writeFileSync(join(workspace, '.gitignore'), '.sdk-it/\n');
  assert.equal(
    spawnSync('git', ['init', '--quiet'], { cwd: workspace }).status,
    0,
  );

  const result = runCli(
    workspace,
    'init',
    '--project',
    './apps/api/tsconfig.app.json',
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    readFileSync(join(project, 'sdk-it.config.ts'), 'utf8'),
    `import { defineConfig } from '@sdk-it/cli';

export default defineConfig({
  tsconfig: './tsconfig.app.json',
  packageName: '@acme/api-client',
});
`,
  );
  assert.equal(
    readFileSync(join(workspace, '.gitignore'), 'utf8'),
    `.sdk-it/
!apps/api/.sdk-it/
apps/api/.sdk-it/*
!apps/api/.sdk-it/package.json
`,
  );
  assert.equal(existsSync(join(project, '.gitignore')), false);
  assert.deepEqual(
    JSON.parse(readFileSync(join(workspace, 'package.json'), 'utf8'))
      .workspaces,
    ['apps/*', 'apps/api/.sdk-it'],
  );
  const stubManifest = readFileSync(
    join(project, '.sdk-it', 'package.json'),
    'utf8',
  );
  assert.deepEqual(JSON.parse(stubManifest), {
    name: '@acme/api-client',
    version: '0.0.1',
    type: 'module',
    main: './dist/index.js',
    module: './dist/index.js',
    types: './dist/index.d.ts',
    publishConfig: { access: 'public' },
    exports: {
      './package.json': './package.json',
      '.': {
        types: './dist/index.d.ts',
        import: './dist/index.js',
        default: './dist/index.js',
      },
    },
    dependencies: {
      'fast-content-type-parse': '^3.0.0',
      zod: '^4.6.7',
    },
  });
  assert.equal(existsSync(join(workspace, 'sdk-it.config.ts')), false);
  writeFileSync(join(project, '.sdk-it', 'generated.ts'), 'generated');
  assert.equal(
    spawnSync(
      'git',
      ['check-ignore', '--quiet', 'apps/api/.sdk-it/generated.ts'],
      {
        cwd: workspace,
      },
    ).status,
    0,
  );
  assert.equal(
    spawnSync(
      'git',
      ['check-ignore', '--quiet', 'apps/api/.sdk-it/package.json'],
      { cwd: workspace },
    ).status,
    1,
  );

  const generateResult = runCli(
    workspace,
    'generate',
    '--config',
    'apps/api/sdk-it.config.ts',
  );
  assert.equal(generateResult.status, 0, generateResult.stderr);
  assert.equal(
    readFileSync(join(project, '.sdk-it', 'package.json'), 'utf8'),
    stubManifest,
  );
});

test('generateProject detects a custom Prisma client and maps Decimal to string', async () => {
  await using project = await createPrismaHonoWorkspace();
  const { output, tsconfig } = project;
  await generateProject({ tsconfig, output });

  const generatedOutput = readFileSync(
    join(output, 'src', 'outputs', 'list-books.ts'),
    'utf8',
  );
  assert.match(generatedOutput, /'price': string/);
});

test("generateProject applies preset: 'prisma' when the client resolves", async () => {
  await using project = await createPrismaHonoWorkspace();
  const { output, tsconfig } = project;
  await generateProject({ tsconfig, output, preset: 'prisma' });

  const generatedOutput = readFileSync(
    join(output, 'src', 'outputs', 'list-books.ts'),
    'utf8',
  );
  assert.match(generatedOutput, /'price': string/);
});

test("generateProject skips Prisma detection with preset: 'none'", async () => {
  await using project = await createPrismaHonoWorkspace({
    enumSchema: false,
  });
  const { output, tsconfig } = project;
  await generateProject({ tsconfig, output, preset: 'none' });

  const generatedOutput = readFileSync(
    join(output, 'src', 'outputs', 'list-books.ts'),
    'utf8',
  );
  assert.match(generatedOutput, /'price': models\.Decimal/);
});

test("generateProject rejects preset: 'prisma' when Prisma cannot be resolved", async () => {
  await using project = await createHonoWorkspace();
  const { output, tsconfig } = project;

  await assert.rejects(
    generateProject({ tsconfig, output, preset: 'prisma' }),
    new Error(
      `Prisma preset was requested, but no Prisma client import was found in ${tsconfig}. Run prisma generate or set preset to 'none'.`,
    ),
  );
});

test('initializeProject preserves repository settings and is idempotent', async () => {
  await using project = await createHonoWorkspace();
  const { tsconfig, path: workspace } = project;
  writeFileSync(join(workspace, '.gitignore'), 'dist/\n');
  writeFileSync(
    join(workspace, 'package.json'),
    JSON.stringify({ private: true, workspaces: ['packages/*'] }, null, 2),
  );

  const cli = await import('@sdk-it/cli');
  assert.equal(typeof cli.initializeProject, 'function');

  await cli.initializeProject({ cwd: workspace, tsconfig });
  await cli.initializeProject({ cwd: workspace, tsconfig });

  assert.equal(
    readFileSync(join(workspace, '.gitignore'), 'utf8'),
    'dist/\n!.sdk-it/\n.sdk-it/*\n!.sdk-it/package.json\n',
  );
  assert.deepEqual(
    JSON.parse(readFileSync(join(workspace, 'package.json'), 'utf8'))
      .workspaces,
    ['packages/*', '.sdk-it'],
  );
  assert.equal(
    readFileSync(join(workspace, 'sdk-it.config.ts'), 'utf8'),
    `import { defineConfig } from '@sdk-it/cli';

export default defineConfig({
  tsconfig: './tsconfig.json',
});
`,
  );
  assert.equal(existsSync(join(workspace, '.sdk-it', 'package.json')), true);
});

test('initializeProject validates package.json before modifying repository files', async () => {
  await using project = await createHonoWorkspace();
  const { tsconfig, path: workspace } = project;
  writeFileSync(join(workspace, '.gitignore'), 'dist/\n');
  writeFileSync(join(workspace, 'package.json'), '{ invalid json');

  await assert.rejects(initializeProject({ cwd: workspace, tsconfig }));

  assert.equal(readFileSync(join(workspace, '.gitignore'), 'utf8'), 'dist/\n');
  assert.equal(existsSync(join(workspace, 'sdk-it.config.ts')), false);
});

test('initializeProject validates the tsconfig before modifying repository files', async () => {
  await using project = await createHonoWorkspace();
  const { tsconfig, path: workspace } = project;
  rmSync(tsconfig);
  writeFileSync(join(workspace, '.gitignore'), 'dist/\n');
  writeFileSync(
    join(workspace, 'package.json'),
    JSON.stringify({ private: true }, null, 2),
  );

  await assert.rejects(
    initializeProject({ cwd: workspace, tsconfig }),
    new Error(`Could not find a TypeScript project at ${tsconfig}.`),
  );

  assert.equal(readFileSync(join(workspace, '.gitignore'), 'utf8'), 'dist/\n');
  assert.deepEqual(
    JSON.parse(readFileSync(join(workspace, 'package.json'), 'utf8')),
    { private: true },
  );
  assert.equal(existsSync(join(workspace, 'sdk-it.config.ts')), false);
});

test('generateProject does not rewrite an unchanged client package', async () => {
  await using project = await createHonoWorkspace();
  const { output, tsconfig } = project;
  await generateProject({ tsconfig, output });
  const manifest = join(output, 'package.json');
  const firstModifiedAt = statSync(manifest).mtimeMs;

  await new Promise((resolve) => setTimeout(resolve, 25));
  await generateProject({ tsconfig, output });

  assert.equal(statSync(manifest).mtimeMs, firstModifiedAt);

  const runtimeEntry = join(output, 'dist', 'api', 'books.js');
  rmSync(runtimeEntry);
  await generateProject({ tsconfig, output });
  assert.equal(existsSync(runtimeEntry), true);
});

test('generateProject synchronizes generated package metadata on regeneration', async () => {
  await using project = await createHonoWorkspace();
  const { output, tsconfig } = project;
  await generateProject({
    tsconfig,
    output,
    packageName: '@example/first-client',
  });

  const manifestPath = join(output, 'package.json');
  const staleManifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  staleManifest.dependencies = {};
  writeFileSync(manifestPath, `${JSON.stringify(staleManifest, null, 2)}\n`);

  await generateProject({
    tsconfig,
    output,
    packageName: '@example/second-client',
  });

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.name, '@example/second-client');
  assert.deepEqual(manifest.dependencies, {
    'fast-content-type-parse': '^3.0.0',
    zod: '^4.6.7',
  });
});

test('generateProject rejects a generated client that does not compile and does not cache it', async () => {
  await using project = await createHonoWorkspace();
  const { tsconfig } = project;
  await using outputDirectory = await new TemporaryFiles().directory(
    'sdk-it-unresolvable-output-',
  );
  const output = outputDirectory.path;
  await assert.rejects(
    generateProject({ tsconfig, output }),
    (error: Error) => {
      assert.match(error.message, /^Failed to compile generated client:/);
      assert.match(error.message, /TS2307/);
      const headers =
        stripVTControlCharacters(error.message).match(/^.*error TS\d+:.*$/gm) ??
        [];
      assert.deepEqual(headers, [...new Set(headers)]);
      return true;
    },
  );
  assert.equal(existsSync(join(output, '.project-hash')), false);
  assert.equal(existsSync(join(output, 'dist')), false);
});

test('sdk-it generate exits non-zero when the generated client does not compile', async () => {
  await using project = await createHonoWorkspace();
  const { path: workspace } = project;
  await using outputDirectory = await new TemporaryFiles().directory(
    'sdk-it-unresolvable-output-',
  );
  const output = outputDirectory.path;
  writeFileSync(
    join(workspace, 'sdk-it.config.ts'),
    `
import { defineConfig } from '@sdk-it/cli';

export default defineConfig({
  tsconfig: './tsconfig.json',
  output: ${JSON.stringify(output)},
});
`,
  );

  const result = runCli(workspace, 'generate');

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Failed to compile generated client:/);
  assert.match(result.stderr, /TS2307/);
  assert.doesNotMatch(result.stdout, /Client generated successfully!/);
});
