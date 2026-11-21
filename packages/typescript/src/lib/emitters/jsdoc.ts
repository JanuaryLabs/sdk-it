import type { Annotations } from '@sdk-it/spec';

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

/** The JSDoc block of a property with `annotations`, or nothing when it has none. */
export function annotationDoc(annotations: Annotations): string {
  return jsdoc([
    ...(annotations.title === undefined ? [] : [annotations.title]),
    ...(annotations.description === undefined ? [] : [annotations.description]),
    ...(annotations.deprecated ? ['@deprecated'] : []),
    ...(Object.hasOwn(annotations, 'default')
      ? [`@default ${JSON.stringify(annotations.default)}`]
      : []),
    ...annotations.examples.map(
      (example) => `@example ${JSON.stringify(example)}`,
    ),
    ...(annotations.readOnly ? ['@readonly'] : []),
    ...(annotations.writeOnly ? ['@writeonly'] : []),
  ]);
}
