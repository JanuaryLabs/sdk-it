import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { generateProject, initializeProject } from '@sdk-it/cli';

const repoRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
);
const cliBin = join(repoRoot, 'packages', 'cli', 'dist', 'bin.js');
const tempDirectories: string[] = [];

function runCli(cwd: string, ...args: string[]) {
  return spawnSync(process.execPath, [cliBin, ...args], {
    cwd,
    encoding: 'utf8',
  });
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createHonoWorkspace() {
  const workspace = mkdtempSync(join(tmpdir(), 'sdk-it-project-'));
  tempDirectories.push(workspace);

  mkdirSync(join(workspace, 'src'));
  symlinkSync(join(repoRoot, 'node_modules'), join(workspace, 'node_modules'));
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

  return {
    output: join(workspace, '.sdk-it'),
    tsconfig: join(workspace, 'tsconfig.json'),
    workspace,
  };
}

function createPrismaHonoWorkspace(options: { enumSchema?: boolean } = {}) {
  const enumSchema = options.enumSchema ?? true;
  const project = createHonoWorkspace();
  const generated = join(project.workspace, 'src', 'generated');
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
    join(project.workspace, 'src', 'index.ts'),
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
  const { output, tsconfig } = createHonoWorkspace();
  await generateProject({
    tsconfig,
    output,
  });

  const endpoint = readFileSync(join(output, 'src', 'api', 'books.ts'), 'utf8');
  assert.match(endpoint, /"GET \/books"/);
});

test("generateProject detects Hono when framework is explicitly 'auto'", async () => {
  const { output, tsconfig } = createHonoWorkspace();
  await generateProject({ tsconfig, output, framework: 'auto' });

  const endpoint = readFileSync(join(output, 'src', 'api', 'books.ts'), 'utf8');
  assert.match(endpoint, /"GET \/books"/);
});

test('generated project client is directly importable by Node.js', async () => {
  const { output, tsconfig, workspace } = createHonoWorkspace();
  await generateProject({ tsconfig, output });

  const manifest = JSON.parse(
    readFileSync(join(output, 'package.json'), 'utf8'),
  );
  assert.deepEqual(manifest.exports['.'], {
    types: './dist/index.d.ts',
    import: './dist/index.js',
    default: './dist/index.js',
  });

  rmSync(join(workspace, 'node_modules'));
  mkdirSync(join(workspace, 'node_modules', '@sdk-it'), { recursive: true });
  symlinkSync(output, join(workspace, 'node_modules', '@sdk-it', 'client'));
  for (const dependency of ['fast-content-type-parse', 'zod']) {
    symlinkSync(
      join(repoRoot, 'node_modules', dependency),
      join(workspace, 'node_modules', dependency),
    );
  }

  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `import('@sdk-it/client').then(({ Client }) => console.log(typeof Client))`,
    ],
    { cwd: workspace, encoding: 'utf8' },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'function');
});

test('loadProjectConfig finds a typed config and resolves its paths', async () => {
  const { workspace } = createHonoWorkspace();
  writeFileSync(
    join(workspace, 'sdk-it.config.ts'),
    `
import { defineConfig } from '@sdk-it/cli';

export default defineConfig({
  tsconfig: './tsconfig.json',
});
`,
  );

  const cli = (await import('@sdk-it/cli')) as typeof import('@sdk-it/cli') & {
    loadProjectConfig?: (options: { cwd: string }) => Promise<{
      tsconfig: string;
      output: string;
    }>;
  };
  assert.equal(typeof cli.loadProjectConfig, 'function');

  const config = await cli.loadProjectConfig!({
    cwd: join(workspace, 'src'),
  });
  assert.deepEqual(config, {
    tsconfig: join(workspace, 'tsconfig.json'),
    output: join(workspace, '.sdk-it'),
  });
});

test('sdk-it generate uses the project config through the CLI', () => {
  const { output, workspace } = createHonoWorkspace();
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

test('sdk-it generate accepts an explicit TypeScript config path', () => {
  const { workspace } = createHonoWorkspace();
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

test('sdk-it generate preserves legacy sdk-it.json projects', () => {
  const { workspace } = createHonoWorkspace();
  writeFileSync(
    join(workspace, 'openapi.json'),
    JSON.stringify({
      openapi: '3.1.0',
      info: { title: 'Legacy API', version: '1.0.0' },
      paths: {},
    }),
  );
  writeFileSync(
    join(workspace, 'sdk-it.json'),
    JSON.stringify({
      generators: {
        typescript: {
          spec: './openapi.json',
          output: './legacy-client',
          mode: 'minimal',
          name: 'LegacyClient',
          install: false,
          defaultFormatter: false,
          readme: false,
        },
      },
    }),
  );

  const result = runCli(workspace, 'generate', '--config', 'sdk-it.json');

  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(join(workspace, 'legacy-client', 'index.ts')), true);
  assert.equal(
    existsSync(join(workspace, 'legacy-client', 'package.json')),
    false,
  );
});

test('sdk-it init --project initializes the backend client workspace', () => {
  const { workspace } = createHonoWorkspace();
  writeFileSync(
    join(workspace, 'package.json'),
    JSON.stringify({ private: true }, null, 2),
  );

  const result = runCli(workspace, 'init', '--project', './tsconfig.json');

  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    readFileSync(join(workspace, 'sdk-it.config.ts'), 'utf8'),
    `import { defineConfig } from '@sdk-it/cli';

export default defineConfig({
  tsconfig: './tsconfig.json',
});
`,
  );
  assert.equal(
    readFileSync(join(workspace, '.gitignore'), 'utf8'),
    '.sdk-it/\n',
  );
  assert.deepEqual(
    JSON.parse(readFileSync(join(workspace, 'package.json'), 'utf8'))
      .workspaces,
    ['.sdk-it'],
  );
});

test('generateProject detects a custom Prisma client and maps Decimal to string', async () => {
  const { output, tsconfig } = createPrismaHonoWorkspace();
  await generateProject({ tsconfig, output });

  const generatedOutput = readFileSync(
    join(output, 'src', 'outputs', 'list-books.ts'),
    'utf8',
  );
  assert.match(generatedOutput, /'price': string/);
});

test("generateProject applies preset: 'prisma' when the client resolves", async () => {
  const { output, tsconfig } = createPrismaHonoWorkspace();
  await generateProject({ tsconfig, output, preset: 'prisma' });

  const generatedOutput = readFileSync(
    join(output, 'src', 'outputs', 'list-books.ts'),
    'utf8',
  );
  assert.match(generatedOutput, /'price': string/);
});

test("generateProject skips Prisma detection with preset: 'none'", async () => {
  const { output, tsconfig } = createPrismaHonoWorkspace({
    enumSchema: false,
  });
  await generateProject({ tsconfig, output, preset: 'none' });

  const generatedOutput = readFileSync(
    join(output, 'src', 'outputs', 'list-books.ts'),
    'utf8',
  );
  assert.match(generatedOutput, /'price': models\.Decimal/);
});

test("generateProject rejects preset: 'prisma' when Prisma cannot be resolved", async () => {
  const { output, tsconfig } = createHonoWorkspace();

  await assert.rejects(
    generateProject({ tsconfig, output, preset: 'prisma' }),
    new Error(
      `Prisma preset was requested, but no Prisma client import was found in ${tsconfig}. Run prisma generate or set preset to 'none'.`,
    ),
  );
});

test('initializeProject preserves repository settings and is idempotent', async () => {
  const { tsconfig, workspace } = createHonoWorkspace();
  writeFileSync(join(workspace, '.gitignore'), 'dist/\n');
  writeFileSync(
    join(workspace, 'package.json'),
    JSON.stringify({ private: true, workspaces: ['packages/*'] }, null, 2),
  );

  const cli = (await import('@sdk-it/cli')) as typeof import('@sdk-it/cli') & {
    initializeProject?: (options: {
      cwd: string;
      tsconfig: string;
    }) => Promise<void>;
  };
  assert.equal(typeof cli.initializeProject, 'function');

  await cli.initializeProject!({ cwd: workspace, tsconfig });
  await cli.initializeProject!({ cwd: workspace, tsconfig });

  assert.equal(
    readFileSync(join(workspace, '.gitignore'), 'utf8'),
    'dist/\n.sdk-it/\n',
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
});

test('initializeProject validates package.json before modifying repository files', async () => {
  const { tsconfig, workspace } = createHonoWorkspace();
  writeFileSync(join(workspace, '.gitignore'), 'dist/\n');
  writeFileSync(join(workspace, 'package.json'), '{ invalid json');

  await assert.rejects(initializeProject({ cwd: workspace, tsconfig }));

  assert.equal(readFileSync(join(workspace, '.gitignore'), 'utf8'), 'dist/\n');
  assert.equal(existsSync(join(workspace, 'sdk-it.config.ts')), false);
});

test('initializeProject validates the tsconfig before modifying repository files', async () => {
  const { tsconfig, workspace } = createHonoWorkspace();
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
  const { output, tsconfig } = createHonoWorkspace();
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
  const { output, tsconfig } = createHonoWorkspace();
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
    zod: '^4.3.0',
  });
});
