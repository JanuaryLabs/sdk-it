import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const runtimeSource = join(
  dirname(
    createRequire(import.meta.url).resolve('@sdk-it/runtime/package.json'),
  ),
  'src',
);

/** `import sources from 'runtime-sources'`: @sdk-it/runtime's files, which every generated SDK carries, as { path: text }. */
const runtimeSources = {
  name: 'runtime-sources',
  setup(build) {
    build.onResolve({ filter: /^runtime-sources$/ }, (args) => ({
      path: args.path,
      namespace: 'runtime-sources',
    }));
    build.onLoad({ filter: /.*/, namespace: 'runtime-sources' }, async () => {
      const paths = (await readdir(runtimeSource, { recursive: true }))
        .filter(
          (path) =>
            path.endsWith('.ts') &&
            !path.endsWith('.test.ts') &&
            path !== 'index.ts',
        )
        .sort();
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

export default { plugins: [runtimeSources] };
