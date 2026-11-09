import nx from '@nx/eslint-plugin';
import zukhruf from '@zukhruf/eslint';
import modernNode from '@zukhruf/eslint/modern-node';
import { manifest, moduleBoundaries } from '@zukhruf/eslint/nx';
import { defineConfig } from 'eslint/config';

const typescriptMessage =
  "Import TypeScript 7 from '@typescript/native/*'. The root 'typescript' package is the TypeScript 6 API that Nx and typescript-eslint load.";
const typescriptPath = { name: 'typescript', message: typescriptMessage };
const typescriptSubpaths = {
  group: ['typescript/*'],
  message: typescriptMessage,
};
const zodSubpathMessage =
  "Import zod from 'zod'. sdk-it supports zod 4 only, and the 'zod/v3' and 'zod/v4' subpaths are for zod 3 interop.";
const zodSubpaths = { regex: '^zod/v[34](/|$)', message: zodSubpathMessage };
const zodSubpathLiteral = 'Literal[value=/^zod\\/v[34](\\/|$)/]';
export const importBans = {
  paths: [typescriptPath],
  patterns: [typescriptSubpaths, zodSubpaths],
};

export const sharedConfig = [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  ...zukhruf.configs['base'],
  ...zukhruf.configs['tests'],
  ...zukhruf.configs['diagnostics'],
  ...zukhruf.configs['env'],
  ...zukhruf.configs['react'],
  ...zukhruf.configs['nx-project-json'],
  ...manifest.configs.recommended,
  {
    ignores: [
      '**/dist',
      '**/vite.config.*.timestamp*',
      '**/vitest.config.*.timestamp*',
      '**/build',
      '**/.react-router',
    ],
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      '@nx/enforce-module-boundaries': ['error', moduleBoundaries()],
    },
  },
  {
    files: [
      '**/*.test.ts',
      '**/*.test.tsx',
      '**/*.test.js',
      '**/*.test.jsx',
      '**/*.spec.ts',
      '**/*.spec.tsx',
      '**/*.spec.js',
      '**/*.spec.jsx',
      '**/test/**/*.ts',
      '**/test/**/*.tsx',
      '**/test/**/*.js',
      '**/test/**/*.jsx',
      '**/tests/**/*.ts',
      '**/tests/**/*.tsx',
      '**/tests/**/*.js',
      '**/tests/**/*.jsx',
    ],
    rules: {
      '@nx/enforce-module-boundaries': 'off',
    },
  },
  {
    files: [
      '**/*.ts',
      '**/*.tsx',
      '**/*.cts',
      '**/*.mts',
      '**/*.js',
      '**/*.jsx',
      '**/*.cjs',
      '**/*.mjs',
    ],
    rules: {
      'no-restricted-imports': ['error', importBans],
      // no-restricted-imports reads only import and export declarations.
      'no-restricted-syntax': [
        'error',
        {
          selector: `ImportExpression > ${zodSubpathLiteral}.source`,
          message: zodSubpathMessage,
        },
        {
          selector: `CallExpression[callee.name='require'] > ${zodSubpathLiteral}.arguments`,
          message: zodSubpathMessage,
        },
        {
          // z.instanceof(Blob) reads the Blob global when the schema is built:
          // it throws where Blob is missing, and a Blob from another realm or
          // a polyfill fails instanceof (e62c4e1, docs/recipes/file-upload.md).
          selector:
            "CallExpression[callee.object.name='z'][callee.property.name='instanceof'] > Identifier.arguments[name='Blob']",
          message:
            'Use z.custom<Blob>() for a binary field. z.instanceof(Blob) needs the Blob global at run time and rejects a Blob from another realm.',
        },
      ],
    },
  },
  {
    // A test imports what the package exports, by its package specifier: a
    // class with #private fields from source and the same class from dist are
    // two incompatible types (AGENTS.md 'Test Import Rules'). This entry
    // restates the import bans, because a later config replaces the rule's
    // options.
    files: ['**/*.test.ts', '**/*.test.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: importBans.paths,
          patterns: [
            ...importBans.patterns,
            {
              regex: '^\\.\\.?/',
              message:
                "Import the package by its module specifier ('@sdk-it/<name>' or an exported subpath), not by a relative path.",
            },
          ],
        },
      ],
    },
  },
  {
    // validate() builds its input schema from the selector's keys at run time,
    // so the type of the parsed input is a claim the checker cannot prove (#3745).
    files: ['packages/hono/src/lib/runtime/validator.ts'],
    rules: { '@typescript-eslint/consistent-type-assertions': 'off' },
  },
  {
    files: ['**/package.json'],
    rules: {
      // Nx's check compares versions with semver, which cannot read the npm
      // alias spec of TypeScript 7 (`npm:typescript@…`).
      'manifest/dependency-checks': [
        'error',
        {
          ignoredDependencies: ['@typescript/native'],
          projects: {
            // The rule counts @sdk-it/typescript's devDependencies on @sdk-it/testing
            // and @sdk-it/runtime (whose zod it then requires) as inlined
            // (zukhruf #3755), and treats the build-time app/routes.tsx as shipped
            // code (zukhruf #3756).
            'packages/apiref': {
              ignoredDependencies: [
                '@zukhruf/testing',
                '@react-router/dev',
                'zod',
              ],
            },
          },
        },
      ],
    },
  },
];

export default [
  ...sharedConfig,
  ...defineConfig({
    // These fixes give APIs that some browsers do not have, such as Error.isError.
    // So browser code stays out:
    // - @sdk-it/runtime: every generated TypeScript SDK embeds its source
    //   (esbuild.config.mjs of @sdk-it/typescript), and an SDK can run in a browser.
    // - The core and spec files that the browser bundle of @sdk-it/apiref imports.
    // @sdk-it/apiref itself is a browser app. Its config takes sharedConfig.
    ignores: [
      'packages/runtime/**',
      'packages/core/src/lib/json-pointer.ts',
      'packages/core/src/lib/ref.ts',
      'packages/core/src/lib/utils.ts',
      'packages/spec/src/lib/is-primitive-schema.ts',
      'packages/spec/src/lib/is.ts',
      'packages/spec/src/lib/walk-schemas.ts',
    ],
    plugins: { 'modern-node': modernNode },
    extends: ['modern-node/recommended'],
    rules: {
      // Uint8Array.prototype.toHex needs Node 26. The READMEs of @sdk-it/hono and
      // @sdk-it/generic tell users to run on Node 24 or newer.
      'unicorn/prefer-uint8array-hex': 'off',
    },
  }),
];
