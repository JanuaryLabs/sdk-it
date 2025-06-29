import type { OpenAPIObject, OperationObject } from 'openapi3-ts/oas31';
import { camelcase } from 'stringcase';

import { determineGenericTag, sanitizeTag } from './tag.js';

export interface GenerateSdkConfig {
  spec: OpenAPIObject;
  responses?: ResponsesConfig;
  pagination?: PaginationConfig | false;
  operationId?: (
    operation: OperationObject,
    path: string,
    method: string,
  ) => string;
  tag?: (operation: OperationObject, path: string) => string;
}
export interface ResponsesConfig {
  flattenErrorResponses?: boolean;
}

export type PaginationConfig = {
  guess?: boolean;
};

export const defaults: Partial<GenerateSdkConfig> &
  Required<Pick<GenerateSdkConfig, 'operationId' | 'tag'>> = {
  operationId: (operation, path, method) => {
    if (operation.operationId) {
      return camelcase(
        operation.operationId
          .split('#')
          .pop()!
          .replace(/-(?=\d)/g, ''),
      );
    }
    const metadata = operation['x-oaiMeta'];
    if (metadata && metadata.name) {
      return camelcase(metadata.name);
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
  return {
    pagination: coearcePaginationConfig(config.pagination),
    responses: config.responses ?? {},
    spec: config.spec,
    operationId: config.operationId ?? defaults.operationId,
    tag: config.tag ?? defaults.tag,
  };
}

export function coearcePaginationConfig(
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
