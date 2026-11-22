import { hash } from 'node:crypto';
import { dirname } from 'node:path';
import { runContentMapper } from 'ts-content-mapper';

import { DerivedDocuments } from './derived-documents.js';
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
    const project = new DerivedDocuments(
      dirname(configFileName),
      options?.derived ?? {},
    );
    await project.refreshAll();
    const states = project.documents.map((document) => project.state(document));
    return {
      project,
      watchedFiles: [
        ...new Set(states.flatMap((state) => state?.watched ?? [])),
      ],
      configIdentity: hash(
        'sha256',
        JSON.stringify(
          states.map((state) =>
            state?.kind === 'document' ? state.text : state?.message,
          ),
        ),
      ),
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
