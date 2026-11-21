import { test } from '@zukhruf/testing/node';
import assert from 'node:assert/strict';
import { mkdir, symlink } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

import { generateProject } from '@sdk-it/cli';
import { analysisWorkspace, parseErrorFor } from '@sdk-it/testing';

void test('a namespace that only a handler uses is not loaded while the project is analyzed', async () => {
  // Arrange
  await using workspace = await analysisWorkspace('project-unused-namespace-', {
    'src/db.ts': `throw new Error('db.ts ran during analysis');
export const greeting = 'hello';
`,
    'src/routes/greetings.route.ts': `import { Hono } from 'hono';
import { z } from 'zod';
import { validate } from '@sdk-it/hono/runtime';
import * as db from '../db.ts';

export const app = new Hono();

/** @openapi greet @tags greetings */
app.post('/greetings', validate('application/json', (payload) => ({
  name: { select: payload.body.name, against: z.string().min(1) },
})), (c) => c.json({ text: \`\${db.greeting} \${c.var.input.name}\` }));
`,
  });
  const output = join(workspace.path, '.sdk-it');

  // Act
  await generateProject({
    name: 'Greetings',
    packageName: '@acme/greetings-client',
    tsconfig: workspace.tsconfig,
    output,
  });

  // Assert
  const { createGreetings } = await import(
    pathToFileURL(join(output, 'src', 'index.ts')).href
  );
  const client = createGreetings({ baseUrl: 'https://api.example.test' });
  await assert.rejects(
    client.request('POST /greetings', { name: '' }),
    parseErrorFor('name'),
  );
});

void test('a project with no imports in its config validates with an inputs.* validator that the route imports', async () => {
  // Arrange
  await using workspace = await analysisWorkspace('project-inputs-', {
    'src/core/inputs.ts': `import { z } from 'zod';
export const webUrl = z.url();
`,
    'src/routes/profiles.route.ts': `import { Hono } from 'hono';
import { z } from 'zod';
import { validate } from '@sdk-it/hono/runtime';
import * as inputs from '../core/inputs.ts';

export const app = new Hono();

/** @openapi updateProfile @tags profiles */
app.post('/profiles', validate('application/json', (payload) => ({
  website: { select: payload.body.website, against: inputs.webUrl },
  mirrors: { select: payload.body.mirrors, against: z.array(inputs.webUrl) },
})), (c) => c.json(c.var.input));
`,
  });
  const output = join(workspace.path, '.sdk-it');

  // Act
  await generateProject({
    name: 'Profiles',
    packageName: '@acme/profiles-client',
    tsconfig: workspace.tsconfig,
    output,
  });

  // Assert
  const { createProfiles } = await import(
    pathToFileURL(join(output, 'src', 'index.ts')).href
  );
  const client = createProfiles({
    baseUrl: 'https://api.example.test',
    fetch: async (request: Request) => Response.json(await request.json()),
  });
  const valid = {
    website: 'https://example.test',
    mirrors: ['https://mirror.example.test'],
  };
  await assert.rejects(
    client.request('POST /profiles', { ...valid, website: 'not a url' }),
    parseErrorFor('website'),
  );
  await assert.rejects(
    client.request('POST /profiles', { ...valid, mirrors: ['not a url'] }),
    parseErrorFor('mirrors'),
  );
  assert.deepEqual(await client.request('POST /profiles', valid), valid);
});

void test('a route that imports zod as a namespace still validates with it', async () => {
  // Arrange
  await using workspace = await analysisWorkspace('project-zod-namespace-', {
    'src/notes.route.ts': `import { Hono } from 'hono';
import * as z from 'zod';
import { validate } from '@sdk-it/hono/runtime';

export const app = new Hono();

/** @openapi addNote @tags notes */
app.post('/notes', validate('application/json', (payload) => ({
  text: { select: payload.body.text, against: z.string().min(1) },
})), (c) => c.json(c.var.input));
`,
  });
  const output = join(workspace.path, '.sdk-it');

  // Act
  await generateProject({
    name: 'Notes',
    packageName: '@acme/notes-client',
    tsconfig: workspace.tsconfig,
    output,
  });

  // Assert
  const { createNotes } = await import(
    pathToFileURL(join(output, 'src', 'index.ts')).href
  );
  const client = createNotes({ baseUrl: 'https://api.example.test' });
  await assert.rejects(
    client.request('POST /notes', { text: '' }),
    parseErrorFor('text'),
  );
});

void test('an inputs namespace from a package that ships declarations beside its JavaScript validates with that package', async () => {
  // Arrange
  await using workspace = await analysisWorkspace('project-package-inputs-', {
    'node_modules/@acme/validators/package.json': JSON.stringify({
      name: '@acme/validators',
      type: 'module',
      exports: { '.': { types: './index.d.ts', default: './index.js' } },
    }),
    'node_modules/@acme/validators/index.js': `import { z } from 'zod';
export const webUrl = z.url();
`,
    'node_modules/@acme/validators/index.d.ts': `import type { z } from 'zod';
export declare const webUrl: z.ZodURL;
`,
    'src/sites.route.ts': `import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';
import * as inputs from '@acme/validators';

export const app = new Hono();

/** @openapi addSite @tags sites */
app.post('/sites', validate('application/json', (payload) => ({
  website: { select: payload.body.website, against: inputs.webUrl },
})), (c) => c.json(c.var.input));
`,
  });
  const output = join(workspace.path, '.sdk-it');

  // Act
  await generateProject({
    name: 'Sites',
    packageName: '@acme/sites-client',
    tsconfig: workspace.tsconfig,
    output,
  });

  // Assert
  const { createSites } = await import(
    pathToFileURL(join(output, 'src', 'index.ts')).href
  );
  const client = createSites({ baseUrl: 'https://api.example.test' });
  await assert.rejects(
    client.request('POST /sites', { website: 'not a url' }),
    parseErrorFor('website'),
  );
});

void test('two routes that import different modules as inputs each validate with their own module', async () => {
  // Arrange
  await using workspace = await analysisWorkspace('project-two-inputs-', {
    'src/sites/inputs.ts': `import { z } from 'zod';
export const webUrl = z.url();
`,
    'src/sites/sites.route.ts': `import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';
import * as inputs from './inputs.ts';

export const app = new Hono();

/** @openapi addSite @tags sites */
app.post('/sites', validate('application/json', (payload) => ({
  website: { select: payload.body.website, against: inputs.webUrl },
})), (c) => c.json({ website: c.var.input.website }));
`,
    'src/countries/inputs.ts': `import { z } from 'zod';
export const countryCode = z.string().regex(/^[A-Z]{2}$/);
`,
    'src/countries/countries.route.ts': `import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';
import * as inputs from './inputs.ts';

export const app = new Hono();

/** @openapi addCountry @tags countries */
app.post('/countries', validate('application/json', (payload) => ({
  code: { select: payload.body.code, against: inputs.countryCode },
})), (c) => c.json({ code: c.var.input.code }));
`,
  });
  const output = join(workspace.path, '.sdk-it');

  // Act
  await generateProject({
    name: 'Places',
    packageName: '@acme/places-client',
    tsconfig: workspace.tsconfig,
    output,
  });

  // Assert
  const { createPlaces } = await import(
    pathToFileURL(join(output, 'src', 'index.ts')).href
  );
  const client = createPlaces({
    baseUrl: 'https://api.example.test',
    fetch: async (request: Request) => Response.json(await request.json()),
  });
  await assert.rejects(
    client.request('POST /sites', { website: 'not a url' }),
    parseErrorFor('website'),
  );
  await assert.rejects(
    client.request('POST /countries', { code: 'jordan' }),
    parseErrorFor('code'),
  );
  assert.deepEqual(
    await client.request('POST /sites', { website: 'https://example.test' }),
    { website: 'https://example.test' },
  );
  assert.deepEqual(await client.request('POST /countries', { code: 'JO' }), {
    code: 'JO',
  });
});
void test('a project route validates with the values of the $Enums it imports from a generated Prisma client', async () => {
  // Arrange
  await using workspace = await analysisWorkspace('project-prisma-enums-', {
    'src/generated/package.json': '{"type":"commonjs"}',
    'src/generated/client.d.ts': `export declare const $Enums: {
  Sex: { female: 'female'; male: 'male' };
};
`,
    'src/generated/client.js': `exports.$Enums = { Sex: { female: 'female', male: 'male' } };
`,
    'src/patients.route.ts': `import { Hono } from 'hono';
import { z } from 'zod';
import { validate } from '@sdk-it/hono/runtime';
import { $Enums } from './generated/client.js';

export const app = new Hono();

/** @openapi addPatient @tags patients */
app.post('/patients', validate('application/json', (payload) => ({
  sex: { select: payload.body.sex, against: z.enum($Enums.Sex) },
})), (c) => c.json({ sex: c.var.input.sex }));
`,
  });
  const output = join(workspace.path, '.sdk-it');

  // Act
  await generateProject({
    name: 'Patients',
    packageName: '@acme/patients-client',
    tsconfig: workspace.tsconfig,
    output,
  });

  // Assert
  const { createPatients } = await import(
    pathToFileURL(join(output, 'src', 'index.ts')).href
  );
  const client = createPatients({
    baseUrl: 'https://api.example.test',
    fetch: async (request: Request) => Response.json(await request.json()),
  });
  await assert.rejects(
    client.request('POST /patients', { sex: 'unknown' }),
    parseErrorFor('sex'),
  );
  assert.deepEqual(await client.request('POST /patients', { sex: 'female' }), {
    sex: 'female',
  });
});

void test('a project route that imports $Enums from a package whose Prisma client is not generated fails before any against runs, naming the import', async () => {
  // Arrange
  await using workspace = await analysisWorkspace('project-prisma-missing-', {
    'src/db.ts': `export * from './generated/client.js';
`,
    'src/patients.route.ts': `import { Hono } from 'hono';
import { z } from 'zod';
import { validate } from '@sdk-it/hono/runtime';
import { $Enums } from './db.ts';

export const app = new Hono();

/** @openapi addPatient @tags patients */
app.post('/patients', validate('application/json', (payload) => ({
  sex: { select: payload.body.sex, against: z.enum($Enums.Sex) },
})), (c) => c.json({ sex: c.var.input.sex }));
`,
  });

  // Act
  const generation = generateProject({
    name: 'Patients',
    packageName: '@acme/patients-client',
    tsconfig: workspace.tsconfig,
    output: join(workspace.path, '.sdk-it'),
  });

  // Assert
  const shown = relative(process.cwd(), workspace.path);
  await assert.rejects(generation, {
    message: `${workspace.path}/src/patients.route.ts imports $Enums from './db.ts', which an against reads, but it does not load: Cannot find module '${workspace.path}/src/generated/client.js' imported from ${workspace.path}/src/db.ts
TypeScript reports:
${shown}/src/patients.route.ts(4,10): error TS2305: Module '"./db.ts"' has no exported member '$Enums'.
${shown}/src/db.ts(1,15): error TS2307: Cannot find module './generated/client.js' or its corresponding type declarations.
Run the Prisma client's generate target (prisma generate) before sdk-it generate.`,
  });
});

void test('a project route that imports $Enums from a referenced workspace package whose Prisma client is not generated fails, naming the import, the missing client and TypeScript errors', async () => {
  // Arrange: Meddit's layout (#5143). The package's types entry is built, the
  // tsconfig references the package, so TypeScript reads its source, and that
  // source re-exports a client that was never generated.
  await using workspace = await analysisWorkspace(
    'project-prisma-referenced-',
    {
      'packages/db/package.json': JSON.stringify({
        name: '@acme/db',
        type: 'module',
        exports: {
          '.': { types: './dist/index.d.ts', import: './dist/index.js' },
        },
      }),
      'packages/db/tsconfig.lib.json': JSON.stringify({
        compilerOptions: {
          composite: true,
          emitDeclarationOnly: true,
          allowImportingTsExtensions: true,
          rewriteRelativeImportExtensions: true,
          module: 'ESNext',
          moduleResolution: 'bundler',
          target: 'ESNext',
          rootDir: 'src',
          outDir: 'dist',
          skipLibCheck: true,
        },
        include: ['src/**/*.ts'],
      }),
      'packages/db/src/index.ts': `export * from './prisma/client.ts';
`,
      'packages/db/dist/index.d.ts': `export * from './prisma/client.ts';
`,
      'packages/db/dist/index.js': `export * from './prisma/client.js';
`,
      'tsconfig.app.json': JSON.stringify({
        compilerOptions: {
          target: 'ESNext',
          module: 'ESNext',
          moduleResolution: 'bundler',
          allowImportingTsExtensions: true,
          noEmit: true,
          skipLibCheck: true,
        },
        include: ['src/**/*.ts'],
        references: [{ path: './packages/db/tsconfig.lib.json' }],
      }),
      'src/patients.route.ts': `import { Hono } from 'hono';
import { z } from 'zod';
import { validate } from '@sdk-it/hono/runtime';
import { $Enums } from '@acme/db';

export const app = new Hono();

/** @openapi addPatient @tags patients */
app.post('/patients', validate('application/json', (payload) => ({
  sex: { select: payload.body.sex, against: z.enum($Enums.Sex) },
})), (c) => c.json({ sex: c.var.input.sex }));
`,
    },
  );
  await mkdir(join(workspace.path, 'node_modules/@acme'), { recursive: true });
  await symlink(
    join(workspace.path, 'packages/db'),
    join(workspace.path, 'node_modules/@acme/db'),
  );

  // Act
  const generation = generateProject({
    name: 'Patients',
    packageName: '@acme/patients-client',
    tsconfig: join(workspace.path, 'tsconfig.app.json'),
    output: join(workspace.path, '.sdk-it'),
  });

  // Assert
  const shown = relative(process.cwd(), workspace.path);
  await assert.rejects(generation, (error: unknown) => {
    assert.ok(Error.isError(error));
    assert.ok(
      error.message.startsWith(
        `${workspace.path}/src/patients.route.ts imports $Enums from '@acme/db', which an against reads, but it does not load: `,
      ),
      error.message,
    );
    // TypeScript checks a referenced package's source in its own project, so
    // the app's program reports only the import; Node's error names the
    // client file that is missing and who imports it.
    assert.ok(
      error.message.includes(
        `Cannot find module '${workspace.path}/packages/db/src/prisma/client.ts' imported from ${workspace.path}/packages/db/src/index.ts\nTypeScript reports:\n${shown}/src/patients.route.ts(4,10): error TS2305: Module '"@acme/db"' has no exported member '$Enums'.\n`,
      ),
      error.message,
    );
    assert.ok(
      error.message.endsWith(
        "\nRun the Prisma client's generate target (prisma generate) before sdk-it generate.",
      ),
      error.message,
    );
    return true;
  });
});

void test('a project route that imports $Enums from a Prisma client that is not generated fails, though TypeScript cannot resolve the client', async () => {
  // Arrange
  await using workspace = await analysisWorkspace('project-prisma-absent-', {
    'src/patients.route.ts': `import { Hono } from 'hono';
import { z } from 'zod';
import { validate } from '@sdk-it/hono/runtime';
import { $Enums } from './generated/client.js';

export const app = new Hono();

/** @openapi addPatient @tags patients */
app.post('/patients', validate('application/json', (payload) => ({
  sex: { select: payload.body.sex, against: z.enum($Enums.Sex) },
})), (c) => c.json({ sex: c.var.input.sex }));
`,
  });

  // Act
  const generation = generateProject({
    name: 'Patients',
    packageName: '@acme/patients-client',
    tsconfig: workspace.tsconfig,
    output: join(workspace.path, '.sdk-it'),
  });

  // Assert
  const shown = relative(process.cwd(), workspace.path);
  await assert.rejects(generation, {
    message: `${workspace.path}/src/patients.route.ts imports $Enums from './generated/client.js', which an against reads, but it does not load: Cannot find module '${workspace.path}/src/generated/client.js'
TypeScript reports:
${shown}/src/patients.route.ts(4,24): error TS2307: Cannot find module './generated/client.js' or its corresponding type declarations.
Run the Prisma client's generate target (prisma generate) before sdk-it generate.`,
  });
});

void test('a project route whose against reads a named import other than $Enums or Prisma fails', async () => {
  // Arrange
  await using workspace = await analysisWorkspace('project-named-import-', {
    'src/sexes.ts': `export const Sex = { female: 'female', male: 'male' } as const;
`,
    'src/patients.route.ts': `import { Hono } from 'hono';
import { z } from 'zod';
import { validate } from '@sdk-it/hono/runtime';
import { Sex } from './sexes.ts';

export const app = new Hono();

/** @openapi addPatient @tags patients */
app.post('/patients', validate('application/json', (payload) => ({
  sex: { select: payload.body.sex, against: z.enum(Sex) },
})), (c) => c.json(c.var.input));
`,
  });

  // Act
  const generation = generateProject({
    name: 'Patients',
    packageName: '@acme/patients-client',
    tsconfig: workspace.tsconfig,
    output: join(workspace.path, '.sdk-it'),
  });

  // Assert
  await assert.rejects(generation, {
    message: `POST /patients input sex: against reads Sex, which is neither z nor a namespace it is given. An against may read only z, the import * as <name> namespaces of its route file (such as inputs.*) and the named imports analyze() allows (allowedNamedImports). Write the schema inline.\n  at ${workspace.path}/src/patients.route.ts:10:52`,
  });
});
