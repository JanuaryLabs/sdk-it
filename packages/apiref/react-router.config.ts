import type { Config } from '@react-router/dev/config';

export default {
  ssr: true,
  buildDirectory: 'dist',
  serverModuleFormat: 'esm',
  ...(process.env.VITE_SDK_IT_STATIC === 'true'
    ? {
        ssr: false,
        async prerender({ getStaticPaths }) {
          return getStaticPaths();
        },
      }
    : {}),
} satisfies Config;
