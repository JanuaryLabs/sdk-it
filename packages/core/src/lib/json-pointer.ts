/**
 * The reference tokens of a JSON Pointer written as a URI fragment, the part
 * after `#` (RFC 6901 §6): each segment URI-decoded, then `~1` read as `/`
 * and `~0` as `~`.
 */
export function pointerTokens(fragment: string): string[] {
  return fragment
    .split('/')
    .filter(Boolean)
    .map((segment) =>
      decodeURIComponent(segment).replaceAll('~1', '/').replaceAll('~0', '~'),
    );
}

/**
 * The value that decoded reference `tokens` name in `document` (RFC 6901 §4),
 * each token an own member of the value before it. Undefined where a token
 * names no member.
 */
export function valueAtPointer(
  document: unknown,
  tokens: readonly string[],
): unknown {
  let current = document;
  for (const token of tokens) {
    if (
      typeof current !== 'object' ||
      current === null ||
      !Object.hasOwn(current, token)
    ) {
      return undefined;
    }
    current = Reflect.get(current, token);
  }
  return current;
}
