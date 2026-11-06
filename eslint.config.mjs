import nx from '@nx/eslint-plugin';
import zukhruf from '@zukhruf/eslint';
import { manifest, moduleBoundaries } from '@zukhruf/eslint/nx';

const typescriptMessage =
  "Import TypeScript 7 from '@typescript/native/*'. The root 'typescript' package is the TypeScript 6 API that Nx and typescript-eslint load.";
const typescriptPath = { name: 'typescript', message: typescriptMessage };
const typescriptSubpaths = {
  group: ['typescript/*'],
  message: typescriptMessage,
};
export const typescriptImportBans = {
  paths: [typescriptPath],
  patterns: [typescriptSubpaths],
};

export default [
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
      'no-restricted-imports': ['error', typescriptImportBans],
    },
  },
  {
    // A test imports what the package exports, by its package specifier: a
    // class with #private fields from source and the same class from dist are
    // two incompatible types (AGENTS.md 'Test Import Rules'). This entry
    // restates the TypeScript bans, because a later config replaces the
    // rule's options.
    files: ['**/*.test.ts', '**/*.test.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [typescriptPath],
          patterns: [
            typescriptSubpaths,
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
