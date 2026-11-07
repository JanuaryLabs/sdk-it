import { nxReadySignal } from '@nx/vite/plugins/nx-ready-signal.plugin';
import { reactRouter } from '@react-router/dev/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  root: import.meta.dirname,
  cacheDir: 'node_modules/.vite/packages/apiref',
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
      'decode-named-character-reference': './entities.ts',
    },
  },
  plugins: [
    tailwindcss(),
    !process.env.VITEST && reactRouter(),
    nxReadySignal(),
  ],
  build: {
    sourcemap: true,
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
});
