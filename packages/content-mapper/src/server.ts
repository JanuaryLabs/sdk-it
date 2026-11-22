import { hash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { type OptionDiagnostic, runContentMapper } from 'ts-content-mapper';

import { DerivedDocuments } from './derived-documents.js';
import { nxEdge } from './nx-edge.js';
import { DiagnosticCode } from './render-document.js';
import { transform } from './transform.js';

interface Options {
  /** A document, relative to the tsconfig, and the backend's OpenAPI definition module that produces it. */
  derived?: Record<string, string>;
}

runContentMapper<Options, DerivedDocuments>({
  diagnosticSource: 'sdk-it',
  // Each derived document is generated from its backend before TypeScript
  // reads it; an edit to a file the analysis read opens the project again.
  openProject: async ({ configFileName, options }) => {
    const directory = dirname(configFileName);
    const derived = options?.derived ?? {};
    const project = new DerivedDocuments(directory, derived);
    await project.refreshAll();
    const states = project.documents.map((document) => project.state(document));
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
        ...new Set([
          ...states.flatMap((state) => state?.watched ?? []),
          ...edgeFiles,
        ]),
      ],
      configIdentity: hash(
        'sha256',
        JSON.stringify([
          states.map((state) =>
            state?.kind === 'document' ? state.text : state?.message,
          ),
          optionDiagnostics.map((diagnostic) => diagnostic.messageText),
        ]),
      ),
      optionDiagnostics,
    };
  },
  transform: ({ fileName, content }, context) => {
    const state = context.project.state(fileName);
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
      state?.kind === 'document' ? state.text : content,
      context.positionEncoding,
    );
  },
});
