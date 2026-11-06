import react from '@zukhruf/eslint/react';

import baseConfig, { typescriptImportBans } from '../../eslint.config.mjs';

// The React configs go before the shared config, so zukhruf's rule changes win.
export default [
  ...react,
  ...baseConfig,
  {
    // The app exports nothing, so a test imports the module it renders by
    // path. This entry keeps the TypeScript bans, because it replaces the
    // shared test entry's options.
    files: ['app/**/*.test.tsx'],
    rules: {
      'no-restricted-imports': ['error', typescriptImportBans],
    },
  },
];
