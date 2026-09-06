import type { OperationObject } from 'openapi3-ts/oas31';

import {
  type OpenAPIDocument,
  type OpenAPISecuritySchemeObject,
  camelcase,
  resolveRef,
} from '@sdk-it/core';

import type { ProcessingDiagnostic, ProcessingPlugin } from './processing.js';
import { determineGenericTag, sanitizeTag } from './tag.js';
import type { IR } from './types.js';

export interface GenerateSdkConfig {
  spec: OpenAPIDocument;
  responses?: ResponsesConfig;
  pagination?: PaginationConfig | false;
  operationId?: (
    operation: OperationObject,
    path: string,
    method: string,
  ) => string;
  tag?: (operation: OperationObject, path: string) => string;
  plugins?: readonly ProcessingPlugin[];
  signal?: AbortSignal;
  onDiagnostic?: (diagnostic: ProcessingDiagnostic) => void;
}
export interface ResponsesConfig {
  flattenErrorResponses?: boolean;
}

export type PaginationConfig = {
  guess?: boolean;
};
export function cleanOperationId(operationId: string) {
  return camelcase(operationId.split('#').pop()!);
}

export const defaults: Partial<GenerateSdkConfig> &
  Required<Pick<GenerateSdkConfig, 'operationId' | 'tag'>> = {
  operationId: (operation, path, method) => {
    if (operation.operationId) {
      return cleanOperationId(operation.operationId);
    }

    return camelcase(
      [method, ...path.replace(/[\\/\\{\\}]/g, ' ').split(' ')]
        .filter(Boolean)
        .join(' ')
        .trim(),
    );
  },
  tag: (operation, path) => {
    return operation.tags?.[0]
      ? sanitizeTag(operation.tags?.[0])
      : determineGenericTag(path, operation);
  },
};

export function coeraceConfig(config: GenerateSdkConfig) {
  const spec: IR = {
    ...config.spec,
    components: {
      ...config.spec.components,
      schemas: config.spec.components?.schemas ?? {},
      securitySchemes: Object.fromEntries(
        Object.entries(config.spec.components?.securitySchemes ?? {}).map(
          ([name, schema]) => [
            name,
            resolveRef<OpenAPISecuritySchemeObject>(config.spec, schema),
          ],
        ),
      ),
    },
    paths: config.spec.paths ?? {},
    'x-docs': [],
    'x-sdks': [],
    'x-tagGroups': config.spec['x-tagGroups'] ?? [
      {
        name: 'API',
        tags: config.spec.tags?.map((tag) => tag.name) ?? [],
      },
    ],
    servers: config.spec.servers ?? [],
    tags: config.spec.tags ?? [],
  };

  return {
    pagination: coercePaginationConfig(config.pagination),
    responses: config.responses ?? {},
    // Authored `x-docs` / `x-sdks` change shape during processing, so they are
    // handed to the overview plugin as raw input instead of living on the IR.
    docs: {
      entries: config.spec['x-docs'] as unknown,
      sdks: config.spec['x-sdks'] as unknown,
    },
    spec,
    operationId: config.operationId ?? defaults.operationId,
    tag: config.tag ?? defaults.tag,
  };
}

export function coercePaginationConfig(
  options: PaginationConfig | undefined | false,
) {
  if (options === undefined) {
    return {
      guess: true,
      enabled: true,
    };
  }
  if (options === false) {
    return {
      enabled: false,
      guess: false,
    };
  }
  // If options is true, we assume pagination is enabled with guessing
  return {
    guess: options.guess ?? true,
    enabled: true,
  };
}
