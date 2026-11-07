import { camelcase } from 'stringcase';

import { pascalcase } from '@sdk-it/core';

import {
  clientDeclarationBindings,
  clientFileBindings,
  clientNamedExports,
} from './client.ts';
import { runtimeRootExports } from './root-exports.ts';
import { securityTypeExports } from './security.ts';

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

/** The names an SDK declares or exports beside the ones it builds from the client name. */
const sdkNames = new Set<string>([
  ...runtimeRootExports.map((binding) => binding.name),
  ...securityTypeExports,
  ...clientFileBindings,
  ...clientDeclarationBindings,
]);

/**
 * The name a generated SDK builds its exports from (`create<Name>`,
 * `<Name>Client`, the default instance `<name>`): `name` in PascalCase.
 * Throws a TypeError, naming `name`, when that is not a TypeScript identifier,
 * the default instance would be a reserved word, or a name built from it is
 * one the SDK already declares or exports (`Request` makes the default
 * instance `request`, which the SDK root exports).
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
  refuseTakenNames(name, pascal, sdkNames);
  return pascal;
}

/**
 * Throws the TypeError of `clientName` when a name built from `pascal`, the
 * client name `name` gives, is one of `taken`: names that come from the spec,
 * such as the input schemas the SDK root exports (`listItemsSchema`).
 */
export function refuseTakenNames(
  name: string,
  pascal: string,
  taken: ReadonlySet<string>,
) {
  const clash = clientNamedExports(pascal).find((built) => taken.has(built));
  if (clash !== undefined) {
    throw new TypeError(
      `The client name "${name}" makes ${clash}, a name the SDK already declares or exports. Rename the client.`,
    );
  }
}
