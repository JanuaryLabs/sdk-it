import runtimeSources from 'runtime-sources';

import { pascalcase } from '@sdk-it/core';
import { sanitizeTag } from '@sdk-it/spec';

import { clientExports } from './client.ts';
import { securityTypeExports } from './security.ts';

export type ModelNamer = (schemaName: string) => string;

const exportedName =
  /^export\s+(?:declare\s+)?(?:abstract\s+)?(?:class|type|interface|const|function|enum)\s+([A-Z]\w*)/gm;

/** PascalCase runtime names the generated SDK root exports besides its models; consumers import them (APIError, NotFound, …). */
const runtimeRootExports = new Set([
  ...[
    runtimeSources['http/response.ts'],
    runtimeSources['http/parser.ts'],
  ].flatMap((source) =>
    [...source.matchAll(exportedName)].map(([, name]) => name),
  ),
  ...securityTypeExports,
]);

/**
 * Names model types so that none shadows a runtime or client export of the SDK
 * root (a trailing `_` is appended), and no two schemas share one.
 */
export function createModelNamer(clientName: string): ModelNamer {
  const reserved = new Set([
    ...runtimeRootExports,
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
