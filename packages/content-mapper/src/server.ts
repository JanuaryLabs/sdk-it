import { hash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { type OptionDiagnostic, runContentMapper } from 'ts-content-mapper';

import { type Derivation, declaredIn } from './derived-document.js';
import { nxEdge } from './nx-edge.js';
import { DiagnosticCode } from './render-document.js';
import { transform } from './transform.js';

interface Options {
  /** A document, relative to the tsconfig, and the backend's OpenAPI definition module that produces it. */
  derived?: Record<string, string>;
}

/** Each derived document of the project, as its last derivation left it. */
type Derivations = ReadonlyMap<string, Derivation>;

runContentMapper<Options, Derivations>({
  diagnosticSource: 'sdk-it',
  // Each derived document is derived from its backend when the project opens,
  // in memory: the committed file is never written. An edit to a file the
  // analysis read opens the project again.
  openProject: async ({ configFileName, options }) => {
    const directory = dirname(configFileName);
    const derived = options?.derived ?? {};
    const project = new Map<string, Derivation>();
    for (const document of declaredIn(directory, derived)) {
      project.set(document.path, await document.derive());
    }
    const states = [...project.values()];
    const optionDiagnostics: OptionDiagnostic[] = [];
    const edgeFiles: string[] = [];
    for (const [document, definition] of Object.entries(derived)) {
      const edge = await nxEdge(directory, resolve(directory, definition));
      edgeFiles.push(...edge.read);
      if (edge.missing !== undefined) {
        optionDiagnostics.push({
          path: ['derived', document],
          code: DiagnosticCode.NxEdge,
          messageText: `${document} is derived from the Nx project "${edge.missing}", but this project has no Nx edge to it, so Nx's cache and nx affected miss a change to the backend. Add "${edge.missing}" to implicitDependencies in this project's project.json, or under "nx" in its package.json.`,
        });
      }
    }
    return {
      project,
      watchedFiles: [
        ...new Set([...states.flatMap((state) => state.sources), ...edgeFiles]),
      ],
      configIdentity: hash(
        'sha256',
        JSON.stringify([
          states.map((state) =>
            state.kind === 'derived' ? state.text : state.message,
          ),
          optionDiagnostics.map((diagnostic) => diagnostic.messageText),
        ]),
      ),
      optionDiagnostics,
    };
  },
  transform: ({ fileName, content }, context) => {
    const state = context.project.get(fileName);
    if (state?.kind === 'failed') {
      return {
        text: 'export {};\n',
        extension: '.ts',
        diagnostics: [
          {
            code: DiagnosticCode.Analysis,
            messageText: state.message,
            start: 0,
            length: 0,
          },
        ],
      };
    }
    return transform(
      fileName,
      content,
      context.positionEncoding,
      state?.kind === 'derived' ? state.text : content,
    );
  },
});
