import nx from '@nx/eslint-plugin';
import zukhruf from '@zukhruf/eslint';
import { manifest, moduleBoundaries } from '@zukhruf/eslint/nx';

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
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'typescript',
              message:
                "Import TypeScript 7 from '@typescript/native/*'. The root 'typescript' package is the TypeScript 6 API that Nx and typescript-eslint load.",
            },
          ],
          patterns: [
            {
              group: ['typescript/*'],
              message:
                "Import TypeScript 7 from '@typescript/native/*'. The root 'typescript' package is the TypeScript 6 API that Nx and typescript-eslint load.",
            },
          ],
        },
      ],
    },
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
