import { pascalcase } from '@sdk-it/core';
import { sanitizeTag } from '@sdk-it/spec';

import { clientExports } from './client.ts';
import { runtimeRootExports } from './root-exports.ts';
import { securityTypeExports } from './security.ts';

export type ModelNamer = (schemaName: string) => string;

/**
 * Names model types so that none shadows a runtime or client export of the SDK
 * root (a trailing `_` is appended), and no two schemas share one.
 */
export function createModelNamer(clientName: string): ModelNamer {
  const reserved = new Set([
    ...runtimeRootExports.map(({ name }) => name),
    ...securityTypeExports,
    ...clientExports(clientName),
  ]);
  const owners = new Map<string, string>();
  return (schemaName) => {
    const base = pascalcase(sanitizeTag(schemaName));
    const name = reserved.has(base) ? `${base}_` : base;
    const owner = owners.get(name);
    if (owner === undefined) {
      owners.set(name, schemaName);
    } else if (owner !== schemaName) {
      throw new TypeError(
        `Schemas "${owner}" and "${schemaName}" both become the TypeScript type ${name}; rename one of them in the spec`,
      );
    }
    return name;
  };
}
