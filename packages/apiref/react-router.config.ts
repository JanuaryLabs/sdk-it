import type { Config } from '@react-router/dev/config';
import { join } from 'node:path';

export default {
  ssr: true,
  buildDirectory: join(process.env.VITE_SDK_IT_OUTPUT ?? './', 'dist'),
  serverModuleFormat: 'esm',
  ...(process.env.VITE_SDK_IT_STATIC === 'true'
    ? {
        ssr: false,
        async prerender() {
          return ['/'];
        },
      }
    : {}),
} satisfies Config;

// NOTE: to build static site switch ssr to false and enable prerendering

// import type { Config } from '@react-router/dev/config';

// export default {
//   ssr: false,
//   buildDirectory: 'dist',
//   serverModuleFormat: 'esm',
//   async prerender() {
//     return ['/'];
//   },
// } satisfies Config;
