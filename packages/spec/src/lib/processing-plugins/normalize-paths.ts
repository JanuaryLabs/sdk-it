import type { PathItemObject, PathsObject } from 'openapi3-ts/oas31';

import { methods } from '@sdk-it/core/paths.js';
import { followRef } from '@sdk-it/core/ref.js';

import type { ProcessingPlugin } from '../processing.js';

export function normalizePaths(): ProcessingPlugin {
  return {
    name: 'normalize-paths',
    process({ spec, report }) {
      const paths: PathsObject = {};
      const operationSources = new Map<string, string>();
      for (const [path, pathItem] of Object.entries(spec.paths)) {
        const normalizedPath = path.replace(/:([^/]+)/g, '{$1}');
        const target = (paths[normalizedPath] ??= {});
        const source = pathItem.$ref
          ? {
              ...followRef<PathItemObject>(spec, pathItem.$ref),
              ...pathItem,
            }
          : pathItem;
        delete source.$ref;
        Object.assign(
          target,
          Object.fromEntries(
            Object.entries(source).filter(
              ([key]) =>
                key !== 'parameters' &&
                !methods.some((method) => method === key),
            ),
          ),
        );
        for (const method of methods) {
          const operation = source[method];
          if (operation) {
            const operationKey = `${normalizedPath}:${method}`;
            const previousPath = operationSources.get(operationKey);
            if (previousPath) {
              const message = `Both ${previousPath} and ${path} define ${method.toUpperCase()} after path normalization`;
              report({
                severity: 'error',
                code: 'path-operation-collision',
                message,
                path: `${method.toUpperCase()} ${normalizedPath}`,
              });
              throw new Error(message);
            }
            const parameters = [
              ...(source.parameters ?? []),
              ...(operation.parameters ?? []),
            ];
            target[method] = {
              ...operation,
              ...(parameters.length > 0 ? { parameters } : {}),
            };
            operationSources.set(operationKey, path);
          }
        }
        if (normalizedPath !== path) {
          report({
            severity: 'info',
            code: 'path-normalized',
            message: `Normalized path ${path} to ${normalizedPath}`,
            path,
          });
        }
      }
      spec.paths = paths;
    },
  };
}
