import {
  type ContentMapperDiagnostic,
  MappedCodeBuilder,
  type PositionEncoding,
  SpanMapFeature,
  type TransformResult,
  stringIndexToPosition,
} from 'ts-content-mapper';

import { type DocumentDiagnostic, renderLocatedIn } from './render-document.js';

const navigation =
  SpanMapFeature.Definition |
  SpanMapFeature.TypeDefinition |
  SpanMapFeature.References |
  SpanMapFeature.Hover |
  SpanMapFeature.DocumentHighlights;

/**
 * The content mapper's answer for the OpenAPI document `content`, the text of
 * `fileName`: its SDK module with each name mapped to the document, or an
 * empty module, and the document's diagnostics, in the negotiated encoding.
 * A derived document renders from `derived`, what its backend produces now,
 * and maps into `content`, the bytes the committed file holds.
 */
export async function transform(
  fileName: string,
  content: string,
  encoding: PositionEncoding,
  derived: string = content,
): Promise<TransformResult> {
  const rendered = await renderLocatedIn(fileName, derived, content);
  const diagnostics = rendered.diagnostics.map((diagnostic) =>
    encode(content, encoding, diagnostic),
  );
  if (rendered.kind === 'failed') {
    return { text: 'export {};\n', extension: '.ts', diagnostics };
  }

  const builder = new MappedCodeBuilder(content, {
    positionEncoding: encoding,
  });
  let cursor = 0;
  for (const { generated, original } of rendered.mappings) {
    builder.append(rendered.text.slice(cursor, generated.start));
    builder.appendAtom(
      rendered.text.slice(generated.start, generated.end),
      original.start,
      original.end,
      navigation,
    );
    cursor = generated.end;
  }
  builder.append(rendered.text.slice(cursor));
  return { ...builder.build('.ts'), diagnostics };
}

function encode(
  content: string,
  encoding: PositionEncoding,
  { code, message, range }: DocumentDiagnostic,
): ContentMapperDiagnostic {
  const start = stringIndexToPosition(content, range.start, encoding);
  return {
    code,
    messageText: message,
    start,
    length: stringIndexToPosition(content, range.end, encoding) - start,
  };
}
