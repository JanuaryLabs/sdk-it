import { ESLint } from 'eslint';
import { globSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

// modern-node/recommended turns on these plugins, and their fixes can give APIs
// that some browsers do not have. Its exclusions live in eslint.config.mjs.
const nodeOnlyRule = /^(?:modern-node|e18e|unicorn)\//u;
const root = resolve(import.meta.dirname, '..');
const clientDirectory = join(root, 'packages/apiref/dist/client');

function mapSources(mapFile) {
  const { sources } = JSON.parse(readFileSync(mapFile, 'utf8'));
  return sources.map((source) =>
    relative(root, resolve(dirname(mapFile), source)),
  );
}

// A workspace package reaches the bundle as its dist output, which ESLint
// ignores, so the file's own source map names the file that a person edits.
function sourceFiles(bundledFile) {
  return bundledFile.includes('/dist/')
    ? mapSources(join(root, `${bundledFile}.map`))
    : [bundledFile];
}

// The source maps of the build list what is left after tree shaking, so this
// reads what the browser gets, not what the source imports.
const bundled = globSync('**/*.map', { cwd: clientDirectory })
  .flatMap((mapFile) => mapSources(join(clientDirectory, mapFile)))
  .filter(
    (file) => file.startsWith('packages/') && !file.includes('/node_modules/'),
  );
const files = [...new Set(bundled.flatMap(sourceFiles))].sort();

if (!files.some((file) => !file.startsWith('packages/apiref/'))) {
  throw new Error(
    `The source maps in ${relative(root, clientDirectory)} name no shared file. Run the build of @sdk-it/apiref, with build.sourcemap on.`,
  );
}

// The real ESLint class finds the config of each file as `eslint .` does: a root
// ignores entry does not reach a project that spreads the root config.
const eslint = new ESLint({ cwd: root });
const failures = [];
for (const file of files) {
  const config = await eslint.calculateConfigForFile(join(root, file));
  const enabledNodeRules = Object.entries(config?.rules ?? {})
    .filter(([name, [severity]]) => nodeOnlyRule.test(name) && severity !== 0)
    .map(([name]) => name);
  if (enabledNodeRules.length > 0) {
    failures.push(
      `${file}: ${enabledNodeRules.length} rules, such as ${enabledNodeRules[0]}`,
    );
  }
}

if (failures.length > 0) {
  console.error(
    `The browser bundle of @sdk-it/apiref has files that get rules for Node. Add each file to the ignores of the modern-node entry in eslint.config.mjs:\n${failures.join('\n')}`,
  );
  process.exitCode = 1;
} else {
  console.log(
    `None of the ${files.length} files in the browser bundle of @sdk-it/apiref gets rules for Node.`,
  );
}
