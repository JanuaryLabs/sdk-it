import { reactRouter } from '@react-router/dev/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';





export default defineConfig(() => ({
  root: __dirname,
  cacheDir: 'node_modules/.vite/packages/apiref',
  server: {
    port: 4200,
    host: 'localhost',
  },
  preview: {
    port: 4300,
    host: 'localhost',
  },
  resolve: {
    alias: {
      'node:path': 'rollup-plugin-node-polyfills/polyfills/path',
    },
  },
  plugins: [
    tailwindcss(),
    reactRouter(),
    // nodePolyfills({
    //   exclude: ['stream'],
    //   include: ['path'],
    //   protocolImports: false,
    // }),
  ],
  build: {
    outDir: './dist',
    emptyOutDir: true,
    reportCompressedSize: true,
    commonjsOptions: {
      transformMixedEsModules: true,
    },
  },
  define: {
    'import.meta.vitest': undefined,
  },
}));