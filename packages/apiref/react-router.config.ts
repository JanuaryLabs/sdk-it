import type { Config } from '@react-router/dev/config';

export default {
  ssr: true,
  buildDirectory: 'dist',
  serverModuleFormat: 'esm',
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
