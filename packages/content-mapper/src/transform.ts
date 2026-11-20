import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  type ContentMapperDiagnostic,
  MappedCodeBuilder,
  type PositionEncoding,
  SpanMapFeature,
  type TransformResult,
  stringIndexToPosition,
} from 'ts-content-mapper';
import { type Document, parseDocument } from 'yaml';

import { Documents, SpecLoader, UnresolvedReferenceError } from '@sdk-it/spec';
import { renderModule } from '@sdk-it/typescript';

import { type Range, locate } from './locate.js';

/** The code of each diagnostic the mapper reports, under the source `sdk-it`. */
export const DiagnosticCode = {
  /** The text is not YAML. */
  Yaml: 1,
  /** A `$ref` does not resolve, or a document it names cannot be read. */
  Load: 2,
  /** The SDK cannot be rendered from the spec. */
  Render: 3,
} as const;

const navigation =
  SpanMapFeature.Definition |
  SpanMapFeature.TypeDefinition |
  SpanMapFeature.References |
  SpanMapFeature.Hover |
  SpanMapFeature.DocumentHighlights;

const fileStart: Range = { start: 0, end: 0 };

/**
 * The SDK of the OpenAPI document that `content`, the text of `fileName`,
 * holds: one TypeScript module whose names map to where the document declares
 * them. A document that does not render is an empty module with diagnostics.
 */
export async function transform(
  fileName: string,
  content: string,
  encoding: PositionEncoding,
): Promise<TransformResult> {
  const document = parseDocument(content);
  const diagnostics = document.errors.map((error) =>
    diagnostic(content, encoding, DiagnosticCode.Yaml, error.message, {
      start: error.pos[0],
      end: error.pos[1],
    }),
  );
  const url = pathToFileURL(fileName);
  const fail = (code: number, error: unknown, range: Range) => ({
    text: 'export {};\n',
    extension: '.ts' as const,
    // A later step that fails on YAML with errors fails because of them.
    diagnostics: diagnostics.length
      ? diagnostics
      : [diagnostic(content, encoding, code, reason(error), range)],
  });

  let spec;
  try {
    spec = await new SpecLoader(
      Documents.standard([[url, document.toJS()]]),
    ).load(url);
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

  const builder = new MappedCodeBuilder(content, {
    positionEncoding: encoding,
  });
  let cursor = 0;
  for (const span of module.spans.toSorted((a, b) => a.start - b.start)) {
    const range =
      span.start >= cursor ? locate(document, span.location) : undefined;
    if (!range) {
      continue;
    }
    builder.append(module.text.slice(cursor, span.start));
    builder.appendAtom(
      module.text.slice(span.start, span.end),
      range.start,
      range.end,
      navigation,
    );
    cursor = span.end;
  }
  builder.append(module.text.slice(cursor));
  return { ...builder.build('.ts'), diagnostics };
}

/** `store.openapi.yaml` exports `store`, `createStore`, `StoreClient`, …. */
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
  encoding: PositionEncoding,
  code: number,
  messageText: string,
  range: Range,
): ContentMapperDiagnostic {
  // A parser can report a range past the end of the text, which TypeScript refuses.
  const start = Math.min(range.start, content.length);
  const end = Math.min(Math.max(range.end, start), content.length);
  const encodedStart = stringIndexToPosition(content, start, encoding);
  return {
    code,
    messageText,
    start: encodedStart,
    length: stringIndexToPosition(content, end, encoding) - encodedStart,
  };
}

function reason(error: unknown) {
  return Error.isError(error) ? error.message : String(error);
}
