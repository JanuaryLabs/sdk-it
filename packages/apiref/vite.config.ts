import { reactRouter } from '@react-router/dev/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig((config) => ({
  root: __dirname,
  base:
    config.command === 'build' && process.env.VITE_BASE
      ? `/apiref/${process.env.VITE_BASE}/`
      : '/',
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
  plugins: [tailwindcss(), reactRouter()],
  build: {
    sourcemap: config.command !== 'build',
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
