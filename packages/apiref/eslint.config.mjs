import nx from '@nx/eslint-plugin';

import baseConfig from '../../eslint.config.mjs';

// The React preset goes before the shared config, so zukhruf's rule changes win.
export default [...nx.configs['flat/react'], ...baseConfig];
