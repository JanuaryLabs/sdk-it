import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { type Document, parseDocument } from 'yaml';

import { Documents, SpecLoader, UnresolvedReferenceError } from '@sdk-it/spec';
import { renderModule } from '@sdk-it/typescript';

import { type Range, locate } from './locate.js';

export type { Range } from './locate.js';

/** The code of each diagnostic a document can have. */
export const DiagnosticCode = {
  /** The text is not YAML. */
  Yaml: 1,
  /** A `$ref` does not resolve, or a document it names cannot be read. */
  Load: 2,
  /** The SDK cannot be rendered from the spec. */
  Render: 3,
  /** A derived document's backend does not analyze. */
  Analysis: 4,
} as const;

type Code = (typeof DiagnosticCode)[keyof typeof DiagnosticCode];

/** A problem in the document, at `range` of its text. */
export interface DocumentDiagnostic {
  readonly code: Code;
  readonly message: string;
  readonly range: Range;
}

/** A name of the module, at `generated` of its text, and what the document declares there, at `original` of the document's text. */
export interface DocumentMapping {
  readonly generated: Range;
  readonly original: Range;
}

/**
 * The SDK an OpenAPI document renders to. `documents` is the URI of each
 * document read, the document first, also when rendering failed, so a host
 * can watch a referenced file that does not exist yet.
 */
export type RenderedDocument =
  | {
      readonly kind: 'module';
      /** One TypeScript module: the SDK's root exports, the runtime embedded. */
      readonly text: string;
      readonly mappings: readonly DocumentMapping[];
      readonly documents: readonly string[];
      /** YAML errors of a document that still parsed into a spec. */
      readonly diagnostics: readonly DocumentDiagnostic[];
    }
  | {
      readonly kind: 'failed';
      readonly documents: readonly string[];
      readonly diagnostics: readonly [
        DocumentDiagnostic,
        ...DocumentDiagnostic[],
      ];
    };

const fileStart: Range = { start: 0, end: 0 };

/**
 * Renders the OpenAPI document `content`, the text of `fileName`, to its SDK.
 * The names come from the file name before its first `.`: `store.openapi.yaml`
 * exports `store`, `createStore`, `StoreClient`, …. Files the document
 * references through `$ref` are read; the document itself is not.
 */
export async function renderDocument(
  fileName: string,
  content: string,
): Promise<RenderedDocument> {
  const document = parseDocument(content);
  const yamlErrors = document.errors.map((error) =>
    diagnostic(content, DiagnosticCode.Yaml, error.message, {
      start: error.pos[0],
      end: error.pos[1],
    }),
  );
  const url = pathToFileURL(fileName);
  const documents = Documents.standard([[url, document.toJS()]]);
  const fail = (code: Code, error: unknown, range: Range): RenderedDocument => {
    const [first, ...rest] = yamlErrors;
    return {
      kind: 'failed',
      documents: documents.uris(),
      // A later step that fails on YAML with errors fails because of them.
      diagnostics: first
        ? [first, ...rest]
        : [diagnostic(content, code, reason(error), range)],
    };
  };

  let spec;
  try {
    spec = await new SpecLoader(documents).load(url);
  } catch (error) {
    return fail(
      DiagnosticCode.Load,
      error,
      referenceRange(error, url, document),
    );
  }
  let module;
  try {
    module = await renderModule(spec, { name: clientName(fileName) });
  } catch (error) {
    return fail(DiagnosticCode.Render, error, fileStart);
  }

  const mappings: DocumentMapping[] = [];
  let cursor = 0;
  for (const span of module.spans.toSorted((a, b) => a.start - b.start)) {
    const original =
      span.start >= cursor ? locate(document, span.location) : undefined;
    if (original) {
      mappings.push({
        generated: { start: span.start, end: span.end },
        original,
      });
      cursor = span.end;
    }
  }
  return {
    kind: 'module',
    text: module.text,
    mappings,
    documents: documents.uris(),
    diagnostics: yamlErrors,
  };
}

function clientName(fileName: string) {
  const [name = ''] = basename(fileName).split('.');
  return name;
}

function referenceRange(error: unknown, url: URL, document: Document): Range {
  if (
    error instanceof UnresolvedReferenceError &&
    error.location.document === url.href
  ) {
    return locate(document, [...error.location.tokens, '$ref']) ?? fileStart;
  }
  return fileStart;
}

function diagnostic(
  content: string,
  code: Code,
  message: string,
  range: Range,
): DocumentDiagnostic {
  // A parser can report a range past the end of the text, which TypeScript refuses.
  const start = Math.min(range.start, content.length);
  const end = Math.min(Math.max(range.end, start), content.length);
  return { code, message, range: { start, end } };
}

function reason(error: unknown) {
  return Error.isError(error) ? error.message : String(error);
}
