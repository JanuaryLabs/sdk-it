import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react-swc';
import * as path from 'path';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/packages/ui',
  plugins: [
    react(),
    tailwindcss(),
    dts({
      entryRoot: 'src',
      tsconfigPath: path.join(__dirname, 'tsconfig.lib.json'),
    }),
  ],
  assetsInclude: ['**/*.css'],
  build: {
    outDir: './dist',
    emptyOutDir: true,
    reportCompressedSize: true,
    sourcemap: true,
    commonjsOptions: {
      transformMixedEsModules: true,
    },
    lib: {
      entry: 'src/index.ts',
      name: 'ui',
      fileName: 'index',
      // Change this to the formats you want to support.
      // Don't forget to update your package.json as well.
      formats: ['es' as const],
    },
    rollupOptions: {
      // External packages that should not be bundled into your library.
      external: [
        'react',
        'react-dom',
        'react/jsx-runtime',
        '@tanstack/react-query',

        // Other UI libraries
        'cmdk',
        'date-fns',
        'embla-carousel-react',
        'firebase',
        'input-otp',
        'lucide-react',
        'next-themes',
        'react-hook-form',
        'react-resizable-panels',
        'recharts',
        'sonner',
        'tailwind-merge',
        'tw-animate-css',
        'vaul',
        'zod',
        'class-variance-authority',
      ],
      output: {
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
}));
