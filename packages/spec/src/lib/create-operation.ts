import type {
  ParameterObject,
  ReferenceObject,
  ResponsesObject,
  SchemaObject,
} from 'openapi3-ts/oas31';

import { isEmpty } from '@sdk-it/core/utils.js';

import type { OurRequestBodyObject, TunedOperationObject } from './types.js';

export function createOperation(options: {
  name: string;
  group: string;
  security?: string[];
  parameters?: {
    query?: Record<string, { schema: SchemaObject; required?: boolean }>;
    path?: Record<string, { schema: SchemaObject; required?: boolean }>;
    header?: Record<string, { schema: SchemaObject; required?: boolean }>;
    cookie?: Record<string, { schema: SchemaObject; required?: boolean }>;
  };
  response: Record<string, SchemaObject | Record<string, SchemaObject>>; // Key is statusCode-contentType
  request?: Record<string, ReferenceObject>;
}): TunedOperationObject {
  const parameters: ParameterObject[] = [];
  if (!isEmpty(options.parameters)) {
    const locations = ['query', 'path', 'header', 'cookie'] as const;
    for (const location of locations) {
      const locationParams = options.parameters[location];
      if (locationParams) {
        for (const [name, param] of Object.entries(locationParams)) {
          parameters.push({
            name,
            in: location,
            required: param.required ?? false,
            schema: param.schema,
          });
        }
      }
    }
  }
  const responses: ResponsesObject = {};

  for (const [key, schema] of Object.entries(options.response)) {
    const [statusCode, contentType] = key.split(/-(.*)/); // Split on the first dash
    if (!contentType) {
      throw new Error(
        `Response key "${key}" must be in the format "statusCode-contentType"`,
      );
    }
    responses[statusCode] ??= {
      description: `Response for ${statusCode}`,
      content: {},
    };

    if (contentType === 'headers') {
      responses[statusCode].headers = schema;
    } else {
      responses[statusCode].content[contentType] = {
        schema: schema,
      };
    }
  }

  let requestBody: OurRequestBodyObject | undefined = undefined;

  if (options.request) {
    requestBody = { description: 'Request body', content: {} };

    for (const [contentType, schema] of Object.entries(options.request)) {
      requestBody.content[contentType] = { schema: schema };
    }
  }

  return {
    security: (options.security ?? []).map((name) => ({
      [name]: [],
    })),
    'x-fn-name': options.name,
    operationId: options.name,
    tags: [options.group],
    parameters,
    responses,
    requestBody: requestBody as any,
  };
}
