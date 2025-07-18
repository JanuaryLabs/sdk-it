import { reactRouter } from '@react-router/dev/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';





export default defineConfig((config) => ({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/apps/agent',
  worker: {
    format: 'es',
  },
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
      util: './util.ts',
      'node:util': './util.ts',
    },
  },
  plugins: [tailwindcss(), reactRouter()],
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
    process: JSON.stringify({
      platform: 'browser',
      env: JSON.stringify({}),
    }),
  },
}));