import type { Config } from '@react-router/dev/config';

export default {
  ssr: false,
  buildDirectory: 'dist',
  serverModuleFormat: 'esm',
  async prerender() {
    return ['/'];
  },
} satisfies Config;
