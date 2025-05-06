import type { Config } from '@react-router/dev/config';

export default {
  ssr: true,
  buildDirectory: 'dist',
  serverModuleFormat: 'esm',
  async prerender() {
    return ['/'];
  },
} satisfies Config;
