import type {
  OpenAPIObject,
  OperationObject,
  ParameterObject,
  PathsObject,
  ReferenceObject,
  RequestBodyObject,
  ResponseObject,
  ResponsesObject,
  SchemaObject,
} from 'openapi3-ts/oas31';
import { camelcase } from 'stringcase';

import { type Method, methods } from '@sdk-it/core/paths.js';
import { followRef, isRef } from '@sdk-it/core/ref.js';
import { isEmpty } from '@sdk-it/core/utils.js';

import {
  type PaginationGuess,
  guessPagination,
} from './pagination/pagination.js';
import { securityToOptions } from './security.js';

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
export function augmentSpec(config: GenerateSdkConfig) {
  config.spec.paths ??= {};
  const paths: PathsObject = {};
  const usedOperationIds = new Set<string>();

  for (const [path, pathItem] of Object.entries(config.spec.paths)) {
    // Convert Express-style routes (:param) to OpenAPI-style routes ({param})
    const fixedPath = path.replace(/:([^/]+)/g, '{$1}');
    for (const [method, operation] of Object.entries(pathItem) as [
      Method,
      OperationObject,
    ][]) {
      if (!methods.includes(method)) {
        continue;
      }
      const formatOperationId = config.operationId ?? defaults.operationId;
      const formatTag = config.tag ?? defaults.tag;
      const operationTag = formatTag(operation, fixedPath);
      const operationId = findUniqueOperationId(
        usedOperationIds,
        formatOperationId(operation, fixedPath, method),
        [operationTag, method, fixedPath.split('/').filter(Boolean).join('')],
        (id) =>
          formatOperationId(
            { ...operation, operationId: id },
            fixedPath,
            method,
          ),
      );
      usedOperationIds.add(operationId);

      const requestBody = isRef(operation.requestBody)
        ? followRef<RequestBodyObject>(config.spec, operation.requestBody.$ref)
        : operation.requestBody;
      const tunedOperation: TunedOperationObject = {
        ...operation,
        parameters: [
          ...(pathItem.parameters ?? []),
          ...(operation.parameters ?? []),
        ].map((it) =>
          isRef(it) ? followRef<ParameterObject>(config.spec, it.$ref) : it,
        ),
        tags: [operationTag],
        operationId: operationId,
        responses: resolveResponses(config.spec, operation),
        requestBody: requestBody,
      };

      tunedOperation['x-pagination'] = toPagination(
        config.spec,
        tunedOperation,
      );

      Object.assign(paths, {
        [fixedPath]: {
          ...paths[fixedPath],
          [method]: tunedOperation,
        },
      });
    }
  }
  return { ...config.spec, paths };
}

export type OperationPagination = PaginationGuess & {
  items: string;
};

function toPagination(
  spec: OpenAPIObject,
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
    // console.dir({
    //   [`${method.toUpperCase()} ${fixedPath}`]: {
    //     ...pagination,
    //   },
    // });
    return pagination;
  }
  return undefined;
}

function getResponseContentSchema(
  spec: OpenAPIObject,
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
  spec: OpenAPIObject,
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

export type TunedOperationObject = Omit<
  OperationObject,
  'operationId' | 'tags' | 'parameters' | 'responses'
> & {
  tags: string[];
  operationId: string;
  parameters: ParameterObject[];
  responses: Record<string, ResponseObject>;
  requestBody: RequestBodyObject | undefined;
};

export interface OperationEntry {
  name?: string;
  method: string;
  path: string;
  groupName: string;
  tag: string;
}
export type Operation = {
  entry: OperationEntry;
  operation: TunedOperationObject;
};

function resolveResponses(spec: OpenAPIObject, operation: OperationObject) {
  const responses = operation.responses ?? {};
  const resolved: Record<string, ResponseObject> = {};
  for (const status in responses) {
    const response = isRef(responses[status] as ReferenceObject)
      ? followRef<ResponseObject>(spec, responses[status].$ref)
      : (responses[status] as ResponseObject);
    resolved[status] = response;
  }
  return resolved;
}

export function forEachOperation<T>(
  config: GenerateSdkConfig,
  callback: (entry: OperationEntry, operation: TunedOperationObject) => T,
) {
  const result: T[] = [];
  for (const [path, pathItem] of Object.entries(config.spec.paths ?? {})) {
    const { ...methods } = pathItem;

    for (const [method, operation] of Object.entries(methods) as [
      string,
      OperationObject,
    ][]) {
      const metadata = operation['x-oaiMeta'] ?? {};
      const operationTag = operation.tags?.[0] as string;

      result.push(
        callback(
          {
            name: metadata.name,
            method,
            path: path,
            groupName: operationTag,
            tag: operationTag,
          },
          operation as TunedOperationObject,
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
  tag?: (operation: OperationObject, path: string) => string;
}

/**
 * Set of reserved TypeScript keywords and common verbs potentially used as tags.
 */

const reservedKeywords = new Set([
  'await', // Reserved in async functions
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'implements', // Strict mode
  'import',
  'in',
  'instanceof',
  'interface', // Strict mode
  'let', // Strict mode
  'new',
  'null',
  'package', // Strict mode
  'private', // Strict mode
  'protected', // Strict mode
  'public', // Strict mode
  'return',
  'static', // Strict mode
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  'yield', // Strict mode / Generator functions
  // 'arguments' is not technically a reserved word, but it's a special identifier within functions
  // and assigning to it or declaring it can cause issues or unexpected behavior.
  'arguments',
]);

const reservedSdkKeywords = new Set(['ClientError']);
/**
 * Sanitizes a potential tag name (assumed to be already camelCased)
 * to avoid conflicts with reserved keywords or invalid starting characters (numbers).
 * Appends an underscore if the tag matches a reserved keyword.
 * Prepends an underscore if the tag starts with a number.
 * @param tag The potential tag name, already camelCased.
 * @returns The sanitized tag name.
 */
export function sanitizeTag(tag: string): string {
  // Prepend underscore if starts with a number
  if (/^\d/.test(tag)) {
    return `_${tag}`;
  }
  // Append underscore if it's a reserved keyword
  if (reservedKeywords.has(tag)) {
    return `${tag}_`;
  }
  // Append dollar sign if it's a reserved SDK keyword
  if (reservedSdkKeywords.has(tag)) {
    return `$${tag}`;
  }
  return tag
    .replace('(', ' ')
    .replace(')', ' ')
    .replace('--', ' ')
    .split(' ')
    .map((part) => part.trim())
    .filter(Boolean)
    .join('');
}

/**
 * Attempts to determine a generic tag for an OpenAPI operation based on path and operationId.
 * Rules and fallbacks are documented within the code.
 * @param pathString The path string.
 * @param operation The OpenAPI Operation Object.
 * @returns A sanitized, camelCased tag name string.
 */
export function determineGenericTag(
  pathString: string,
  operation: OperationObject,
): string {
  const operationId = operation.operationId || '';
  const VERSION_REGEX = /^[vV]\d+$/;
  const commonVerbs = new Set([
    // Verbs to potentially strip from operationId prefix
    'get',
    'list',
    'create',
    'update',
    'delete',
    'post',
    'put',
    'patch',
    'do',
    'send',
    'add',
    'remove',
    'set',
    'find',
    'search',
    'check',
    'make',
  ]);

  const segments = pathString.split('/').filter(Boolean);

  const potentialCandidates = segments.filter(
    (segment) =>
      segment &&
      !segment.startsWith('{') &&
      !segment.endsWith('}') &&
      !VERSION_REGEX.test(segment),
  );

  // --- Heuristic 1: Last non-'@' path segment ---
  for (let i = potentialCandidates.length - 1; i >= 0; i--) {
    const segment = potentialCandidates[i];
    if (!segment.startsWith('@')) {
      // Sanitize just before returning
      return sanitizeTag(camelcase(segment));
    }
  }

  const canFallbackToPathSegment = potentialCandidates.length > 0;

  // --- Heuristic 2: OperationId parsing ---
  if (operationId) {
    const lowerOpId = operationId.toLowerCase();
    const parts = operationId
      .replace(/([a-z])([A-Z])/g, '$1_$2')
      .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
      .replace(/([a-zA-Z])(\d)/g, '$1_$2')
      .replace(/(\d)([a-zA-Z])/g, '$1_$2')
      .toLowerCase()
      .split(/[_-\s]+/);

    const validParts = parts.filter(Boolean);

    // Quick skip: If opId is just a verb and we can use Heuristic 3, prefer that.
    if (
      commonVerbs.has(lowerOpId) &&
      validParts.length === 1 &&
      canFallbackToPathSegment
    ) {
      // Proceed directly to Heuristic 3
    }
    // Only process if there are valid parts and the quick skip didn't happen
    else if (validParts.length > 0) {
      const firstPart = validParts[0];
      const isFirstPartVerb = commonVerbs.has(firstPart);

      // Case 2a: Starts with verb, has following parts
      if (isFirstPartVerb && validParts.length > 1) {
        const verbPrefixLength = firstPart.length;
        let nextPartStartIndex = -1;
        if (operationId.length > verbPrefixLength) {
          // Simplified check for next part start
          const charAfterPrefix = operationId[verbPrefixLength];
          if (charAfterPrefix >= 'A' && charAfterPrefix <= 'Z') {
            nextPartStartIndex = verbPrefixLength;
          } else if (charAfterPrefix >= '0' && charAfterPrefix <= '9') {
            nextPartStartIndex = verbPrefixLength;
          } else if (['_', '-'].includes(charAfterPrefix)) {
            nextPartStartIndex = verbPrefixLength + 1;
          } else {
            const match = operationId
              .substring(verbPrefixLength)
              .match(/[A-Z0-9]/);
            if (match && match.index !== undefined) {
              nextPartStartIndex = verbPrefixLength + match.index;
            }
            if (
              nextPartStartIndex === -1 &&
              operationId.length > verbPrefixLength
            ) {
              nextPartStartIndex = verbPrefixLength; // Default guess
            }
          }
        }

        if (
          nextPartStartIndex !== -1 &&
          nextPartStartIndex < operationId.length
        ) {
          const remainingOriginalSubstring =
            operationId.substring(nextPartStartIndex);
          const potentialTag = camelcase(remainingOriginalSubstring);
          if (potentialTag) {
            // Sanitize just before returning
            return sanitizeTag(potentialTag);
          }
        }

        // Fallback: join remaining lowercased parts
        const potentialTagJoined = camelcase(validParts.slice(1).join('_'));
        if (potentialTagJoined) {
          // Sanitize just before returning
          return sanitizeTag(potentialTagJoined);
        }
      }

      // Case 2b: Doesn't start with verb, or only one part (might be verb)
      const potentialTagFull = camelcase(operationId);
      if (potentialTagFull) {
        const isResultSingleVerb = validParts.length === 1 && isFirstPartVerb;

        // Avoid returning only a verb if Heuristic 3 is possible
        if (!(isResultSingleVerb && canFallbackToPathSegment)) {
          if (potentialTagFull.length > 0) {
            // Sanitize just before returning
            return sanitizeTag(potentialTagFull);
          }
        }
      }

      // Case 2c: Further fallbacks within OpId if above failed/skipped
      const firstPartCamel = camelcase(firstPart);
      if (firstPartCamel) {
        const isFirstPartCamelVerb = commonVerbs.has(firstPartCamel);
        if (
          !isFirstPartCamelVerb ||
          validParts.length === 1 ||
          !canFallbackToPathSegment
        ) {
          // Sanitize just before returning
          return sanitizeTag(firstPartCamel);
        }
      }
      if (
        isFirstPartVerb &&
        validParts.length > 1 &&
        validParts[1] &&
        canFallbackToPathSegment
      ) {
        const secondPartCamel = camelcase(validParts[1]);
        if (secondPartCamel) {
          // Sanitize just before returning
          return sanitizeTag(secondPartCamel);
        }
      }
    } // End if(validParts.length > 0) after quick skip check
  } // End if(operationId)

  // --- Heuristic 3: First path segment (stripping '@') ---
  if (potentialCandidates.length > 0) {
    let firstCandidate = potentialCandidates[0];
    if (firstCandidate.startsWith('@')) {
      firstCandidate = firstCandidate.substring(1);
    }
    if (firstCandidate) {
      // Sanitize just before returning
      return sanitizeTag(camelcase(firstCandidate));
    }
  }

  // --- Heuristic 4: Default ---
  console.warn(
    `Could not determine a suitable tag for path: ${pathString}, operationId: ${operationId}. Using 'unknown'.`,
  );
  return 'unknown'; // 'unknown' is safe
}

export function parseJsonContentType(contentType: string | null | undefined) {
  if (!contentType) {
    return null;
  }

  // 1. Trim whitespace
  let mainType = contentType.trim();

  // 2. Remove parameters (anything after the first ';')
  const semicolonIndex = mainType.indexOf(';');
  if (semicolonIndex !== -1) {
    mainType = mainType.substring(0, semicolonIndex).trim(); // Trim potential space before ';'
  }

  // 3. Convert to lowercase for case-insensitive comparison
  mainType = mainType.toLowerCase();

  if (mainType.endsWith('/json')) {
    return mainType.split('/')[1];
  } else if (mainType.endsWith('+json')) {
    return mainType.split('+')[1];
  }
  return null;
}

export function isTextContentType(
  contentType: string | null | undefined,
): boolean {
  if (!contentType) {
    return false; // Handle null, undefined, or empty string
  }

  // 1. Trim whitespace from the input string
  let mainType = contentType.trim();
  // 2. Find the position of the first semicolon (if any) to remove parameters
  const semicolonIndex = mainType.indexOf(';');
  if (semicolonIndex !== -1) {
    // Extract the part before the semicolon and trim potential space
    mainType = mainType.substring(0, semicolonIndex).trim();
  }
  // 3. Convert the main type part to lowercase for case-insensitive comparison
  mainType = mainType.toLowerCase();
  // 4. Compare against the standard text MIME types
  return mainType.startsWith('text/'); // Catch-all for other text/* types
}

/**
 * Checks if a given content type string represents Server-Sent Events (SSE).
 * Handles case-insensitivity, parameters (like charset), and leading/trailing whitespace.
 *
 * @param contentType The content type string to check (e.g., from a Content-Type header).
 * @returns True if the content type is 'text/event-stream', false otherwise.
 */
export function isSseContentType(
  contentType: string | null | undefined,
): boolean {
  if (!contentType) {
    return false; // Handle null, undefined, or empty string
  }

  // 1. Trim whitespace from the input string
  let mainType = contentType.trim();

  // 2. Find the position of the first semicolon (if any) to remove parameters
  const semicolonIndex = mainType.indexOf(';');
  if (semicolonIndex !== -1) {
    // Extract the part before the semicolon and trim potential space
    mainType = mainType.substring(0, semicolonIndex).trim();
  }

  // 3. Convert the main type part to lowercase for case-insensitive comparison
  mainType = mainType.toLowerCase();

  // 4. Compare against the standard SSE MIME type
  return mainType === 'text/event-stream';
}

export function isStreamingContentType(
  contentType: string | null | undefined,
): boolean {
  return contentType === 'application/octet-stream';
}

export function isSuccessStatusCode(statusCode: number | string): boolean {
  if (typeof statusCode === 'string') {
    const statusGroup = +statusCode.slice(0, 1);
    const status = Number(statusCode);
    return (status >= 200 && status < 300) || status >= 2 || statusGroup <= 3;
  }
  statusCode = Number(statusCode);
  return statusCode >= 200 && statusCode < 300;
}

export function isErrorStatusCode(statusCode: number | string): boolean {
  if (typeof statusCode === 'string') {
    const statusGroup = +statusCode.slice(0, 1);
    const status = Number(statusCode);
    return (
      status < 200 ||
      status >= 300 ||
      statusGroup >= 4 ||
      statusGroup === 0 ||
      statusGroup === 1
    );
  }
  statusCode = Number(statusCode);
  return statusCode < 200 || statusCode >= 300;
}

export function patchParameters(
  spec: OpenAPIObject,
  objectSchema: SchemaObject,
  operation: TunedOperationObject,
) {
  const securitySchemes = spec.components?.securitySchemes ?? {};
  const securityOptions = securityToOptions(
    spec,
    operation.security ?? [],
    securitySchemes,
  );

  objectSchema.properties ??= {};
  objectSchema.required ??= [];
  for (const param of operation.parameters) {
    if (param.required) {
      objectSchema.required.push(param.name);
    }
    objectSchema.properties[param.name] = isRef(param.schema)
      ? followRef<SchemaObject>(spec, param.schema.$ref)
      : (param.schema ?? { type: 'string' });
  }
  for (const param of securityOptions) {
    objectSchema.required = (objectSchema.required ?? []).filter(
      (name) => name !== param.name,
    );
    objectSchema.properties[param.name] = isRef(param.schema)
      ? followRef<SchemaObject>(spec, param.schema.$ref)
      : (param.schema ?? { type: 'string' });
  }
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
  request?: Record<string, SchemaObject>;
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

  let requestBody: RequestBodyObject | undefined = undefined;

  if (options.request) {
    requestBody = {
      description: 'Request body',
      content: {},
    };

    for (const [contentType, schema] of Object.entries(options.request)) {
      requestBody.content[contentType] = {
        schema: schema,
      };
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
    requestBody,
  };
}
