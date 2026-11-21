import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { type Plugin, type Rolldown, normalizePath } from 'vite';

import {
  type DocumentDiagnostic,
  renderDocument,
} from '@sdk-it/content-mapper';

/** The extensions an imported OpenAPI document ends with: YAML, and JSON under a name TypeScript accepts for a mapped file. */
const extensions = ['.openapi.yaml', '.openapi'];

const isDocument = (path: string) =>
  extensions.some((extension) => path.endsWith(extension));

/**
 * Serves an imported OpenAPI document as its SDK module, rendered by
 * `@sdk-it/content-mapper` as the TypeScript content mapper renders it:
 * `import { store } from './store.openapi.yaml'`. The module's id is the
 * document's path with `.ts` added, so Vite strips its types.
 */
export class DocumentImports {
  toPlugin(): Plugin {
    return {
      name: 'sdk-it:imports',
      enforce: 'pre',
      // Vite's dependency scan bundles the app with Rolldown, which calls this
      // plugin's resolveId but not its load, and reads the module from disk.
      // A plugin in optimizeDeps.rolldownOptions.plugins loads it there, so
      // the scan follows the SDK to the packages it imports.
      configEnvironment: () => ({
        optimizeDeps: {
          rolldownOptions: {
            plugins: [{ name: 'sdk-it:imports:scan', load: loadDocument }],
          },
        },
      }),
      async resolveId(source, importer, options) {
        if (!isDocument(source)) return null;
        const resolved = await this.resolve(source, importer, {
          ...options,
          skipSelf: true,
        });
        return resolved && !resolved.external ? `${resolved.id}.ts` : null;
      },
      load: loadDocument,
      // A change to a file the document references reloads the module through
      // addWatchFile, but the module's id is not the document's own path, so
      // Vite does not tie a change of the document itself to it.
      hotUpdate({ file, modules }) {
        if (!isDocument(file)) return;
        const module = this.environment.moduleGraph.getModuleById(
          `${normalizePath(file)}.ts`,
        );
        return module ? [...modules, module] : modules;
      },
    };
  }
}

/** Renders the document of the module id `<document>.ts` as its SDK module. */
async function loadDocument(this: Rolldown.PluginContext, id: string) {
  const file = id.slice(0, -'.ts'.length);
  if (!id.endsWith('.ts') || !isDocument(file)) return null;
  const content = await readFile(file, 'utf8');
  const document = await renderDocument(file, content);
  for (const uri of document.documents) {
    if (uri.startsWith('file:')) this.addWatchFile(fileURLToPath(uri));
  }
  const fail = (problem: DocumentDiagnostic) =>
    this.error({
      message: problem.message,
      id: file,
      loc: { file, ...position(content, problem.range.start) },
    });
  if (document.kind === 'failed') return fail(document.diagnostics[0]);
  // A document with YAML errors can still render; it does not run until it is fixed.
  const [yamlError] = document.diagnostics;
  if (yamlError) return fail(yamlError);
  // Vite's SSR runner compiles modules with `new AsyncFunction(code)`, and V8's
  // eval cache keeps each such source, so every reload would leak a module. V8
  // does not cache a source with a tagged template; a build drops this dead code.
  return `${document.text}\nif (0) (() => {})\`\`;\n`;
}

/** The line (from 1) and column (from 0) of `index` in `text`, as Rollup reports a location. */
function position(text: string, index: number) {
  const before = text.slice(0, index);
  const lineStart = before.lastIndexOf('\n') + 1;
  return { line: before.split('\n').length, column: index - lineStart };
}
