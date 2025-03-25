import type {
  OpenAPIObject,
  OperationObject,
  ParameterObject,
  ReferenceObject,
} from 'openapi3-ts/oas31';
import { camelcase } from 'stringcase';

export const defaults: Partial<GenerateSdkConfig> &
  Required<Pick<GenerateSdkConfig, 'operationId'>> = {
  operationId: (operation, path, method) => {
    if (operation.operationId) {
      return camelcase(operation.operationId);
    }
    return camelcase(
      [method, ...path.replace(/[\\/\\{\\}]/g, ' ').split(' ')]
        .filter(Boolean)
        .join(' ')
        .trim(),
    );
  },
};

type TunedOperationObject = OperationObject & {
  operationId: string;
  parameters: (ParameterObject | ReferenceObject)[];
};

export function forEachOperation<T>(
  config: GenerateSdkConfig,
  callback: (
    entry: { name: string; method: string; path: string; groupName: string },
    operation: TunedOperationObject,
  ) => T,
) {
  const result: T[] = [];
  for (const [path, pathItem] of Object.entries(config.spec.paths ?? {})) {
    const { parameters = [], ...methods } = pathItem;

    for (const [method, operation] of Object.entries(methods) as [
      string,
      OperationObject,
    ][]) {
      const [groupName] = operation.tags ?? ['unknown'];
      const formatOperationId = config.operationId ?? defaults.operationId;
      const operationName = formatOperationId(operation, path, method);
      result.push(
        callback(
          { name: operationName, method, path, groupName },
          {
            ...operation,
            parameters: [...parameters, ...(operation.parameters ?? [])],
            operationId: operationName,
          },
        ),
      );
    }
  }
  return result;
}

export interface GenerateSdkConfig {
  spec: OpenAPIObject;
  operationId?: (
    operation: OperationObject,
    path: string,
    method: string,
  ) => string;
}
