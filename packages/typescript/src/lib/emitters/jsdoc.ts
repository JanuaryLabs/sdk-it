/**
 * A JSDoc block holding `lines`, each line of them prefixed with ` * `, or
 * nothing when there are none. A `*` followed by `/` in the text becomes
 * `*\/`, so the text cannot end the comment.
 */
export function jsdoc(lines: readonly string[]): string {
  if (lines.length === 0) {
    return '';
  }
  const body = lines
    .flatMap((line) => line.replaceAll('*/', '*\\/').split('\n'))
    .map((line) => ` * ${line}`.trimEnd());
  return `/**\n${body.join('\n')}\n */`;
}
