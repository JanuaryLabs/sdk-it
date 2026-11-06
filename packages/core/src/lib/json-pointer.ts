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
