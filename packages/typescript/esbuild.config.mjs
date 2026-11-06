import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { runtimeModule } from './runtime-module.mjs';

const runtimePackage = dirname(
  createRequire(import.meta.url).resolve('@sdk-it/runtime/package.json'),
);
const runtimeSource = join(runtimePackage, 'src');

/** The runtime files every generated SDK carries, relative to the runtime's src/. */
async function runtimePaths() {
  return (await readdir(runtimeSource, { recursive: true }))
    .filter(
      (path) =>
        path.endsWith('.ts') &&
        !path.endsWith('.test.ts') &&
        path !== 'index.ts',
    )
    .sort();
}

/** `import sources from 'runtime-sources'`: @sdk-it/runtime's files, which every generated SDK carries, as { path: text }. */
const runtimeSources = {
  name: 'runtime-sources',
  setup(build) {
    build.onResolve({ filter: /^runtime-sources$/ }, (args) => ({
      path: args.path,
      namespace: 'runtime-sources',
    }));
    build.onLoad({ filter: /.*/, namespace: 'runtime-sources' }, async () => {
      const paths = await runtimePaths();
      const sources = Object.fromEntries(
        await Promise.all(
          paths.map(async (path) => [
            path,
            await readFile(join(runtimeSource, path), 'utf8'),
          ]),
        ),
      );
      return {
        contents: `export default ${JSON.stringify(sources)};`,
        loader: 'js',
        watchFiles: paths.map((path) => join(runtimeSource, path)),
      };
    });
  },
};

/** `import runtime from 'runtime-module'`: @sdk-it/runtime joined into the one module a one-module SDK carries. */
const runtimeModuleSource = {
  name: 'runtime-module',
  setup(build) {
    build.onResolve({ filter: /^runtime-module$/ }, (args) => ({
      path: args.path,
      namespace: 'runtime-module',
    }));
    build.onLoad({ filter: /.*/, namespace: 'runtime-module' }, async () => {
      const tsconfig = join(runtimePackage, 'tsconfig.lib.json');
      return {
        contents: `export default ${JSON.stringify(runtimeModule(tsconfig))};`,
        loader: 'js',
        watchFiles: [
          tsconfig,
          ...(await runtimePaths()).map((path) => join(runtimeSource, path)),
        ],
      };
    });
  },
};

export default { plugins: [runtimeSources, runtimeModuleSource] };
