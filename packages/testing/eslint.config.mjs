import baseConfig from '../../eslint.config.mjs';

export default [
  ...baseConfig,
  {
    files: ['**/*.json'],
    rules: {
      '@nx/dependency-checks': [
        'error',
        {
          ignoredFiles: [
            '{projectRoot}/eslint.config.{js,cjs,mjs}',
            '{projectRoot}/esbuild.config.{js,ts,mjs,mts}',
          ],
          // The rule compares versions with semver, which cannot read the
          // npm alias spec of TypeScript 7 (`npm:typescript@…`).
          ignoredDependencies: ['@typescript/native'],
        },
      ],
    },
    languageOptions: {
      parser: await import('jsonc-eslint-parser'),
    },
  },
];
