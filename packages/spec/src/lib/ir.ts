import type {
  OperationObject,
  ParameterObject,
  PathsObject,
  SchemaObject,
} from 'openapi3-ts/oas31';

import { type Method, methods } from '@sdk-it/core/paths.js';
import { resolveRef } from '@sdk-it/core/ref.js';
import { camelcase, snakecase } from '@sdk-it/core/utils.js';

import { toResource } from './guess/guess-resource.js';
import { type GenerateSdkConfig, coeraceConfig } from './options.js';
import { extractOverviewDocs } from './overview-docs/overview-docs.js';
import { toPagination } from './pagination/pagination.js';
import { tuneRequestBody } from './tune-request-body.js';
import { resolveResponses } from './tune-response.js';
import { expandSpec, fixSpec } from './tune.js';
import type { IR, TunedOperationObject } from './types.js';

function findUniqueOperationId(
  usedOperationIds: Set<string>,
  initialId: string,
  choices: string[],
  formatter: (id: string) => string,
) {
  let counter = 1;
  let uniqueOperationId = formatter(initialId);

  while (usedOperationIds.has(uniqueOperationId)) {
    // Try each prepend option
    const prependIndex = Math.min(counter - 1, choices.length - 1);
    const prefix = choices[prependIndex];

    if (prependIndex < choices.length - 1) {
      // Using one of the prepend options
      uniqueOperationId = formatter(
        `${prefix}${initialId.charAt(0).toUpperCase() + initialId.slice(1)}`,
      );
    } else {
      // If we've exhausted all prepend options, start adding numbers
      uniqueOperationId = formatter(
        `${prefix}${initialId.charAt(0).toUpperCase() + initialId.slice(1)}${counter - choices.length + 1}`,
      );
    }
    counter++;
  }

  return uniqueOperationId;
}

export function toIR(config: GenerateSdkConfig, verbose = false): IR {
  const coearcedConfig = coeraceConfig(config);
  if ('x-sdk-augmented' in config.spec) {
    return config.spec as IR; // Already augmented
  }

  const paths: PathsObject = {};
  const usedOperationIds = new Set<string>();

  for (const [path, pathItem] of Object.entries(coearcedConfig.spec.paths)) {
    // Convert Express-style routes (:param) to OpenAPI-style routes ({param})
    const fixedPath = path.replace(/:([^/]+)/g, '{$1}');
    for (const [method, operation] of Object.entries(pathItem) as [
      Method,
      OperationObject,
    ][]) {
      if (!methods.includes(method)) {
        continue;
      }
      const { name } = toResource(operation, fixedPath, method);
      const operationTag = coearcedConfig.tag(operation, fixedPath);
      const operationId = findUniqueOperationId(
        usedOperationIds,
        coearcedConfig.operationId(operation, fixedPath, method),
        [operationTag, method, fixedPath.split('/').filter(Boolean).join('')],
        (id) =>
          coearcedConfig.operationId(
            { ...operation, operationId: id },
            fixedPath,
            method,
          ),
      );
      usedOperationIds.add(operationId);

      const parameters = [
        ...(pathItem.parameters ?? []),
        ...(operation.parameters ?? []),
      ].map((it) => resolveRef<ParameterObject>(coearcedConfig.spec, it));

      const tunedOperation: TunedOperationObject = {
        ...operation,
        parameters,
        'x-fn-name': name,
        'x-fn-group': operationTag,
        tags: [snakecase(operationTag)], // todo: do not transfer casing unless tag cannot be valid identifier
        operationId: operationId,
        responses: resolveResponses(
          coearcedConfig.spec,
          operationId,
          operation,
          coearcedConfig.responses,
        ),
        requestBody: tuneRequestBody(
          coearcedConfig.spec,
          operationId,
          // camelcase(`${name} ${operationTag}`),
          operation,
          parameters,
          operation.security ?? [],
        ),
      };

      if (coearcedConfig.pagination.enabled) {
        if (coearcedConfig.pagination.guess) {
          tunedOperation['x-pagination'] = toPagination(
            coearcedConfig.spec,
            tunedOperation,
          );
        }
      } else {
        delete tunedOperation['x-pagination'];
      }

      Object.assign(paths, {
        [fixedPath]: {
          ...paths[fixedPath],
          [method]: tunedOperation,
        },
      });
    }
  }

  fixSpec(
    coearcedConfig.spec,
    Object.values(coearcedConfig.spec.components.schemas),
  );

  if (verbose) {
    const newRefs: { name: string; value: SchemaObject }[] = [];
    expandSpec(
      coearcedConfig.spec,
      coearcedConfig.spec.components.schemas,
      newRefs,
    );
  }

  return {
    ...coearcedConfig.spec,
    paths,
    'x-docs': extractOverviewDocs(coearcedConfig.spec),
    'x-sdk-augmented': true,
  };
}
