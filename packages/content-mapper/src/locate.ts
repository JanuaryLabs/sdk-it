import { type Document, isMap, isScalar, isSeq } from 'yaml';

/** A range of the document's text: JavaScript string indices, `end` exclusive. */
export interface Range {
  start: number;
  end: number;
}

/**
 * Where the document writes what `tokens` (RFC 6901, unescaped) name: a scalar
 * names itself, a map or a list is named by the key that holds it. Undefined
 * when the document has no such value, as for a value another document holds.
 */
export function locate(
  document: Document,
  tokens: readonly string[],
): Range | undefined {
  let node: unknown = document.contents;
  let name: unknown;
  for (const token of tokens) {
    if (isMap(node)) {
      const pair = node.items.find(
        (item) => isScalar(item.key) && String(item.key.value) === token,
      );
      if (!pair) {
        return undefined;
      }
      name = pair.key;
      node = pair.value;
    } else if (isSeq(node)) {
      name = undefined;
      node = node.items[Number(token)];
    } else {
      return undefined;
    }
  }
  const target = isScalar(node) ? node : name;
  if (!isScalar(target) || !target.range) {
    return undefined;
  }
  return { start: target.range[0], end: target.range[1] };
}
