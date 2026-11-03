import react from '@zukhruf/eslint/react';

import baseConfig from '../../eslint.config.mjs';

// The React configs go before the shared config, so zukhruf's rule changes win.
export default [...react, ...baseConfig];
