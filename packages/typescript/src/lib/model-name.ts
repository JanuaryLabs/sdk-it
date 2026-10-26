import { pascalcase } from '@sdk-it/core';
import { sanitizeTag } from '@sdk-it/spec';

import parserTxt from './http/parser.txt';
import responseTxt from './http/response.txt';
import { securityTypeExports } from './security.ts';
import endpointsTxt from './styles/github/endpoints.txt';

export type ModelNamer = (schemaName: string) => string;

const exportedName =
  /^export\s+(?:declare\s+)?(?:abstract\s+)?(?:class|type|interface|const|function|enum)\s+([A-Z]\w*)/gm;

/** PascalCase names the generated SDK root exports besides its models; consumers import them (APIError, NotFound, Endpoints, …). */
const runtimeRootExports = new Set([
  ...[responseTxt, parserTxt, endpointsTxt].flatMap((source) =>
    [...source.matchAll(exportedName)].map(([, name]) => name),
  ),
  'Servers',
  ...securityTypeExports,
]);

/**
 * Names model types so that none shadows a runtime export of the SDK root or
 * the client class (a trailing `_` is appended), and no two schemas share one.
 */
export function createModelNamer(clientName: string): ModelNamer {
  const owners = new Map<string, string>();
  return (schemaName) => {
    const base = pascalcase(sanitizeTag(schemaName));
    const name =
      runtimeRootExports.has(base) || base === clientName ? `${base}_` : base;
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
