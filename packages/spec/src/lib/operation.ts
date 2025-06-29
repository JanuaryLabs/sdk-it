import type {
  MediaTypeObject,
  OperationObject,
  ParameterObject,
  PathsObject,
  ReferenceObject,
  RequestBodyObject,
  ResponseObject,
  ResponsesObject,
  SchemaObject,
  SecurityRequirementObject,
} from 'openapi3-ts/oas31';

import { type Method, methods } from '@sdk-it/core/paths.js';
import { followRef, isRef, parseRef, resolveRef } from '@sdk-it/core/ref.js';
import { isEmpty, pascalcase, snakecase } from '@sdk-it/core/utils.js';

import { findUniqueSchemaName } from './find-unique-schema-name.js';
import {
  isSseContentType,
  isSuccessStatusCode,
  isTextContentType,
  parseJsonContentType,
} from './is.js';
import {
  type GenerateSdkConfig,
  type ResponsesConfig,
  coeraceConfig,
} from './options.js';
import { extractOverviewDocs } from './overview-docs.js';
import {
  type PaginationGuess,
  guessPagination,
} from './pagination/pagination.js';
import { securityToOptions } from './security.js';
import { expandSpec, fixSpec } from './tune.js';
import type {
  OurOpenAPIObject,
  OurRequestBodyObject,
  TunedOperationObject,
} from './types.js';

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

export function augmentSpec(
  config: GenerateSdkConfig,
  verbose = false,
): OurOpenAPIObject {
  const coearcedConfig = coeraceConfig(config);
  if ('x-sdk-augmented' in config.spec) {
    return config.spec as OurOpenAPIObject; // Already augmented
  }
  const spec: OurOpenAPIObject = {
    ...config.spec,
    components: {
      ...config.spec.components,
      schemas: config.spec.components?.schemas ?? {},
      securitySchemes: config.spec.components?.securitySchemes ?? {},
    },
    paths: config.spec.paths ?? {},
    'x-docs': [],
  };

  const paths: PathsObject = {};
  const usedOperationIds = new Set<string>();

  for (const [path, pathItem] of Object.entries(spec.paths)) {
    // Convert Express-style routes (:param) to OpenAPI-style routes ({param})
    const fixedPath = path.replace(/:([^/]+)/g, '{$1}');
    for (const [method, operation] of Object.entries(pathItem) as [
      Method,
      OperationObject,
    ][]) {
      if (!methods.includes(method)) {
        continue;
      }
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
      ].map((it) => resolveRef<ParameterObject>(spec, it));

      const tunedOperation: TunedOperationObject = {
        ...operation,
        parameters,
        tags: [snakecase(operationTag)],
        operationId: operationId,
        responses: resolveResponses(
          spec,
          operationId,
          operation,
          config.responses,
        ),
        requestBody: tuneRequestBody(
          spec,
          operationId,
          operation,
          parameters,
          operation.security ?? [],
        ),
      };

      if (coearcedConfig.pagination.enabled) {
        if (coearcedConfig.pagination.guess) {
          tunedOperation['x-pagination'] = toPagination(spec, tunedOperation);
        }
      }

      Object.assign(paths, {
        [fixedPath]: {
          ...paths[fixedPath],
          [method]: tunedOperation,
        },
      });
    }
  }

  fixSpec(spec, Object.values(spec.components.schemas));

  if (verbose) {
    const newRefs: { name: string; value: SchemaObject }[] = [];
    expandSpec(spec, spec.components.schemas, newRefs);
  }

  return {
    ...(spec as OurOpenAPIObject),
    paths,
    'x-docs': extractOverviewDocs(spec),
    'x-sdk-augmented': true,
  };
}

export type OperationPagination = PaginationGuess & {
  items: string;
};

function toPagination(
  spec: OurOpenAPIObject,
  tunedOperation: TunedOperationObject,
) {
  if (tunedOperation['x-pagination']) {
    return tunedOperation['x-pagination'];
  }
  const schema = getResponseContentSchema(
    spec,
    tunedOperation.responses['200'],
    'application/json',
  );
  const pagination = guessPagination(
    tunedOperation,
    tunedOperation.requestBody
      ? getRequestContentSchema(
          spec,
          tunedOperation.requestBody,
          'application/json',
        )
      : undefined,
    schema,
  );
  if (pagination && pagination.type !== 'none' && schema) {
    return pagination;
  }
  return undefined;
}

function getResponseContentSchema(
  spec: OurOpenAPIObject,
  response: ResponseObject,
  type: string,
) {
  if (!response) {
    return undefined;
  }
  const content = response.content;
  if (!content) {
    return undefined;
  }
  for (const contentType in content) {
    if (contentType.toLowerCase() === type.toLowerCase()) {
      return isRef(content[contentType].schema)
        ? followRef<SchemaObject>(spec, content[contentType].schema.$ref)
        : content[contentType].schema;
    }
  }
  return undefined;
}

function getRequestContentSchema(
  spec: OurOpenAPIObject,
  requestBody: RequestBodyObject,
  type: string,
) {
  const content = requestBody.content;
  if (!content) {
    return undefined;
  }
  for (const contentType in content) {
    if (contentType.toLowerCase() === type.toLowerCase()) {
      return isRef(content[contentType].schema)
        ? followRef<SchemaObject>(spec, content[contentType].schema.$ref)
        : content[contentType].schema;
    }
  }
  return undefined;
}

function resolveResponses(
  spec: OurOpenAPIObject,
  operationId: string,
  operation: OperationObject,
  responsesConfig?: ResponsesConfig,
) {
  const responses = operation.responses ?? {};
  operation.responses ??= {};
  let foundSuccessResponse = false;
  for (const status in responses) {
    if (status === 'default') {
      delete responses[status]; // Skip default response
      continue;
    }
    // use structuredClone to avoid mutating a response object
    // that is referenced by multiple operations
    operation.responses[status] = structuredClone(
      resolveRef<ResponseObject>(spec, responses[status]),
    );

    if (isSuccessStatusCode(status)) {
      foundSuccessResponse = true;
    }
  }

  if (!foundSuccessResponse) {
    operation.responses['200'] = {
      description: 'OK',
      content: {
        'application/json': {
          schema: {},
        },
      },
    };
  }

  for (const status in operation.responses) {
    const response = operation.responses[status] as ResponseObject;
    const statusCode = +status;

    const outputName =
      statusCode !== 200
        ? pascalcase(operationId) + status
        : findUniqueSchemaName(spec, operationId, [
            'output',
            'payload',
            'result',
          ]);

    if (!responsesConfig?.flattenErrorResponses) {
      if (!isSuccessStatusCode(status)) {
        continue;
      }
    }

    if (isEmpty(response.content)) {
      response.content = {
        'application/octet-stream': {},
      };
    }

    response['x-response-name'] = outputName;

    // if (isErrorStatusCode(status)) {
    //   const mediaType = response.content?.['application/json'];
    //   if (mediaType && isRef(mediaType.schema)) {
    //     const { model } = parseRef(mediaType.schema.$ref);
    //     Object.assign(config.spec.components.schemas[model], {
    //       'x-responsebody': true,
    //       // do not assign response ref to a group
    //       // because they are supposed to be in a separate file only inlined
    //       // schemas are grouped by operationId
    //     });
    //     response['x-response-name'] = model;
    //   }
    //   continue;
    // }

    for (const [contentType, mediaType] of Object.entries(
      response.content as Record<string, MediaTypeObject>,
    )) {
      if (isRef(mediaType.schema)) {
        const { model } = parseRef(mediaType.schema.$ref);
        Object.assign(spec.components.schemas[model], {
          'x-responsebody': true,
          // do not assign response ref to a group
          // because they are supposed to be in a separate file only inlined
          // schemas are grouped by operationId
        });
        response['x-response-name'] = model;
        continue;
      }
      if (isSseContentType(contentType)) {
        continue; // Skip SSE content types
      }
      if (parseJsonContentType(contentType)) {
        if (isEmpty(mediaType.schema)) {
          // add "additionalProperties" because we're certain this is a response body is of json type
          spec.components.schemas[outputName] = {
            type: 'object',
            additionalProperties: true,
          };
        }
      } else {
        spec.components.schemas[outputName] = {
          ...spec.components.schemas[outputName],
          'x-stream': !isTextContentType(contentType),
        };
      }

      spec.components.schemas[outputName] = {
        ...spec.components.schemas[outputName],
        ...mediaType.schema,
        'x-responsebody': true,
        'x-response-group': operationId,
      };
      operation.responses[status].content[contentType].schema = {
        $ref: `#/components/schemas/${outputName}`,
      };
    }
  }

  return operation.responses;
}

export function patchParameters(
  spec: OurOpenAPIObject,
  schema: SchemaObject,
  parameters: ParameterObject[],
  security: SecurityRequirementObject[],
) {
  const securitySchemes = spec.components?.securitySchemes ?? {};
  const securityOptions = securityToOptions(spec, security, securitySchemes);

  let required = Array.isArray(schema.required) ? schema.required : [];
  schema['x-properties'] ??= {};
  for (const param of parameters) {
    if (param.required) {
      required.push(param.name);
    }
    schema['x-properties'][param.name] = {
      'x-in': param.in,
      ...(isRef(param.schema)
        ? followRef<SchemaObject>(spec, param.schema.$ref)
        : (param.schema ?? { type: 'string' })),
    };
  }
  for (const param of securityOptions) {
    required = required.filter((name) => name !== param.name);
    schema['x-properties'][param.name] = {
      'x-in': 'header',
      ...(isRef(param.schema)
        ? followRef<SchemaObject>(spec, param.schema.$ref)
        : (param.schema ?? { type: 'string' })),
    };
  }
  schema['x-required'] = required;
}

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
    operationId: options.name,
    tags: [options.group],
    parameters,
    responses,
    requestBody: requestBody as any,
  };
}

function tuneRequestBody(
  spec: OurOpenAPIObject,
  operationId: string,
  operation: OperationObject,
  parameters: ParameterObject[],
  security: SecurityRequirementObject[],
): OurRequestBodyObject {
  const inputName = findUniqueSchemaName(spec, operationId, [
    'input',
    'payload',
    'request',
  ]);
  const requestBody = isRef(operation.requestBody)
    ? followRef<RequestBodyObject>(spec, operation.requestBody.$ref)
    : (operation.requestBody ?? {
        content: {},
        required: false,
      });
  if (isEmpty(requestBody.content)) {
    const schema: SchemaObject = {
      'x-inputname': inputName,
      'x-requestbody': true,
    };
    patchParameters(spec, schema, parameters, security);
    const tuned: OurRequestBodyObject = {
      ...requestBody,
      content: {
        'application/empty': {
          schema: { $ref: `#/components/schemas/${inputName}` },
        },
      },
    };

    spec.components.schemas[inputName] = schema;
    return tuned;
  }
  for (const contentType in requestBody.content) {
    const mediaType = requestBody.content[contentType];
    let schema: SchemaObject | undefined;

    switch (true) {
      case isRef(mediaType.schema):
        schema = followRef<SchemaObject>(spec, mediaType.schema.$ref);
        // we cannot use the model name as inputName as it might be used in other places that are not request bodies
        // inputName = parseRef(mediaType.schema.$ref).model;
        break;
      case isEmpty(mediaType.schema):
        schema ??= {}; // default to empty schema if not defined
        console.warn(
          `Request body schema for content type "${contentType}" is empty.`,
        );
        break;
      default:
        schema = mediaType.schema;
        break;
    }

    patchParameters(spec, schema, parameters, security);
    spec.components.schemas[inputName] = {
      ...schema,
      'x-requestbody': true,
      'x-inputname': inputName,
    };

    requestBody.content[contentType].schema = {
      $ref: `#/components/schemas/${inputName}`,
    };
  }
  return requestBody as OurRequestBodyObject;
}
