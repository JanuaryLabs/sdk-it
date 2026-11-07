import { camelcase } from 'stringcase';

import { pascalcase } from '@sdk-it/core';

/** ECMAScript reserved words, and the names strict-mode code cannot bind. */
const reservedWords = new Set([
  'arguments',
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'eval',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'implements',
  'import',
  'in',
  'instanceof',
  'interface',
  'let',
  'new',
  'null',
  'package',
  'private',
  'protected',
  'public',
  'return',
  'static',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  'yield',
]);

/**
 * The name a generated SDK builds its exports from (`create<Name>`,
 * `<Name>Client`, the default instance `<name>`): `name` in PascalCase.
 * Throws a TypeError, naming `name`, when that is not a TypeScript identifier
 * or the default instance would be a reserved word.
 */
export function clientName(name: string): string {
  const pascal = pascalcase(name.trim());
  if (!/^[\p{ID_Start}_$][\p{ID_Continue}$‌‍]*$/u.test(pascal)) {
    throw new TypeError(
      `The client name "${name}" becomes ${pascal ? `"${pascal}"` : 'an empty name'}, which is not a TypeScript identifier. A client name starts with a letter, _ or $, and has only letters, digits, _ and $.`,
    );
  }
  const instance = camelcase(pascal);
  if (reservedWords.has(instance)) {
    throw new TypeError(
      `The client name "${name}" makes the default instance ${instance}, which is a reserved word. Rename the client.`,
    );
  }
  return pascal;
}
