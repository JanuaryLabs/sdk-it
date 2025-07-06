import type { OperationObject } from 'openapi3-ts/oas31';
import { camelcase } from 'stringcase';

import { type Method } from '@sdk-it/core/paths.js';

import { cleanOperationId } from '../options.js';

const HTTP_METHOD_ACTIONS = {
  get: { single: 'get', collection: 'list' },
  post: { single: 'create', collection: 'create' },
  put: { single: 'replace', collection: 'replaceAll' },
  patch: { single: 'update', collection: 'updateMany' },
  delete: { single: 'delete', collection: 'deleteMany' },
  head: { single: 'exists', collection: 'checkList' },
  options: { single: 'options', collection: 'optionsList' },
  trace: { single: 'trace', collection: 'traceList' },
  connect: { single: 'connect', collection: 'connectList' },
} as const;

function extractResourceInfo(path: string): {
  resourceName: string;
  isSingleResource: boolean;
  resourceHierarchy: string[];
} {
  const pathSegments = path.split('/').filter(Boolean);

  if (pathSegments.length === 0) {
    return {
      resourceName: 'root',
      isSingleResource: false,
      resourceHierarchy: ['root'],
    };
  }

  const lastSegment = pathSegments[pathSegments.length - 1];
  const isSingleResource =
    lastSegment?.startsWith('{') && lastSegment?.endsWith('}');

  // For single resources, use the parent resource name
  // For collections, use the last segment
  let resourceName: string;
  let resourceHierarchy: string[];

  if (isSingleResource) {
    // Single resource: /users/{id} -> "users"
    const parentSegment = pathSegments[pathSegments.length - 2];
    resourceName = parentSegment || 'item';
    resourceHierarchy = pathSegments
      .filter((segment) => !segment.startsWith('{'))
      .map((segment) => segment.replace(/[{}]/g, ''));
  } else {
    // Collection: /users or /users/active -> "users" or "usersActive"
    resourceName = lastSegment;
    resourceHierarchy = pathSegments
      .filter((segment) => !segment.startsWith('{'))
      .map((segment) => segment.replace(/[{}]/g, ''));
  }

  // Clean and normalize resource name
  const cleanResourceName = resourceName
    .replace(/[{}]/g, '')
    .replace(/[-_]/g, ' ')
    .replace(/[^a-zA-Z0-9\s]/g, '');

  // Generate a hierarchy-based group name for better conflict avoidance
  const hierarchicalName =
    resourceHierarchy.length > 1
      ? resourceHierarchy.join(' ')
      : cleanResourceName;

  return {
    resourceName: cleanResourceName || 'resource',
    isSingleResource,
    resourceHierarchy: [hierarchicalName],
  };
}

function guessOperationName(
  method: Method,
  {
    isSingleResource,
    resourceHierarchy,
  }: ReturnType<typeof extractResourceInfo>,
): { name: string; group: string } {
  const methodAction =
    HTTP_METHOD_ACTIONS[
      method.toLowerCase() as keyof typeof HTTP_METHOD_ACTIONS
    ];

  if (!methodAction) {
    // Fallback for unknown HTTP methods
    const fallbackAction = isSingleResource
      ? method.toLowerCase()
      : `${method.toLowerCase()}All`;
    return {
      name: camelcase(fallbackAction),
      group: camelcase(resourceHierarchy[0]),
    };
  }

  const actionName = isSingleResource
    ? methodAction.single
    : methodAction.collection;

  // Create more descriptive names for complex paths
  const operationName =
    resourceHierarchy.length > 1 && !isSingleResource
      ? `${actionName} ${resourceHierarchy.slice(-1)[0]}` // e.g., "list activeUsers"
      : actionName;

  return {
    name: camelcase(operationName),
    group: camelcase(resourceHierarchy[0]),
  };
}

export function toResource(
  operation: OperationObject,
  path: string,
  method: Method,
): { name: string; group: string } {
  const { resourceName } = extractResourceInfo(path);
  // Priority 1: Explicit name (x-oaiMeta.path)
  if (operation['x-oaiMeta']?.path) {
    return {
      name: operation['x-oaiMeta'].path,
      group: camelcase(resourceName),
    };
  }

  // Priority 2: Non-guessed operationId
  if (operation.operationId) {
    const { resourceName } = extractResourceInfo(path);
    return {
      name: cleanOperationId(operation.operationId),
      group: camelcase(resourceName),
    };
  }

  // Priority 3: CRUD operation name
  return guessOperationName(method, extractResourceInfo(path));
}
