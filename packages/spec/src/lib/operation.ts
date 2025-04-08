import type {
  OpenAPIObject,
  OperationObject,
  ParameterObject,
  ReferenceObject,
} from 'openapi3-ts/oas31';
import { camelcase } from 'stringcase';

export const defaults: Partial<GenerateSdkConfig> &
  Required<Pick<GenerateSdkConfig, 'operationId' | 'tag'>> = {
  operationId: (operation, path, method) => {
    if (operation.operationId) {
      return camelcase(operation.operationId);
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
    return operation.tags?.[0] || determineGenericTag(path, operation);
  },
};

export type TunedOperationObject = OperationObject & {
  operationId: string;
  parameters: (ParameterObject | ReferenceObject)[];
};

export interface OperationEntry {
  name?: string;
  method: string;
  path: string;
  groupName: string;
  tag: string;
}

export function forEachOperation<T>(
  config: GenerateSdkConfig,
  callback: (entry: OperationEntry, operation: TunedOperationObject) => T,
) {
  const result: T[] = [];
  for (const [path, pathItem] of Object.entries(config.spec.paths ?? {})) {
    const { parameters = [], ...methods } = pathItem;

    // Convert Express-style routes (:param) to OpenAPI-style routes ({param})
    const fixedPath = path.replace(/:([^/]+)/g, '{$1}');

    for (const [method, operation] of Object.entries(methods) as [
      string,
      OperationObject,
    ][]) {
      const formatOperationId = config.operationId ?? defaults.operationId;
      const formatTag = config.tag ?? defaults.tag;
      const operationName = formatOperationId(operation, fixedPath, method);
      const operationTag = formatTag(operation, fixedPath);
      const metadata = operation['x-oaiMeta'] ?? {};
      result.push(
        callback(
          {
            name: metadata.name,
            method,
            path: fixedPath,
            groupName: operationTag,
            tag: operationTag,
          },
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
  tag?: (operation: OperationObject, path: string) => string;
}

/**
 * Attempts to determine a generic tag for an OpenAPI operation based on path and operationId.
 * Prioritizes the *last* segment of the path that is not a parameter (`{...}`),
 * not a version string (`vN`), and not starting with `'@'`.
 * If all valid segments start with '@', it falls back to operationId.
 * If operationId fails, it falls back to the *first* valid segment (removing leading '@' if present).
 * Defaults to 'unknown' only as a last resort.
 * @param {string} pathString The path string (e.g., "/users/@me/orders" or "/webhooks/{id}/@original").
 * @param {OperationObject} operation The operation object.
 * @returns {string} The determined tag name (camelCase).
 */
export function determineGenericTag(
  pathString: string,
  operation: OperationObject,
): string {
  const operationId = operation.operationId || '';
  const VERSION_REGEX = /^[vV]\d+$/; // Matches 'v1', 'V2', etc.

  const segments = pathString.split('/').filter(Boolean); // Remove empty segments

  // Get all segments that are potentially meaningful (not params, not versions)
  const potentialCandidates = segments.filter(
    (segment) =>
      segment &&
      !segment.startsWith('{') &&
      !segment.endsWith('}') &&
      !VERSION_REGEX.test(segment),
  );

  // 1. Primary Heuristic: Find the last segment NOT starting with '@'
  for (let i = potentialCandidates.length - 1; i >= 0; i--) {
    const segment = potentialCandidates[i];
    if (!segment.startsWith('@')) {
      return camelcase(segment); // Found the best candidate
    }
  }

  // If we reach here, all potential candidates started with '@', or there were none.

  // 2. Secondary Heuristic: operationId prefix
  if (operationId) {
    const parts = operationId
      .replace(/([A-Z])/g, '_$1') // Insert underscore before uppercase letters
      .split(/[_-\s]+/); // Split by underscore, hyphen, or space

    if (parts.length > 0 && parts[0]) {
      const potentialTag = camelcase(parts[0]);
      // Basic sanity check
      if (potentialTag.length > 1 || parts.length === 1) {
        return potentialTag;
      }
      // Try second part if first was too short/numeric
      if (parts.length > 1 && parts[1] && camelcase(parts[1]).length > 1) {
        return camelcase(parts[1]);
      }
      // Fallback to the first part anyway if it exists
      if (potentialTag) return potentialTag;
    }
  }

  // 3. Tertiary Heuristic: Use the FIRST potential candidate, even if it starts with '@'
  if (potentialCandidates.length > 0) {
    let firstCandidate = potentialCandidates[0];
    // If it starts with '@', remove it before using as tag
    if (firstCandidate.startsWith('@')) {
      firstCandidate = firstCandidate.substring(1);
    }
    // Ensure it's not empty after potentially removing '@'
    if (firstCandidate) {
      return camelcase(firstCandidate);
    }
  }

  // 4. Final Default Tag
  console.warn(
    `Could not determine a suitable tag for path: ${pathString}, operationId: ${operationId}. Using 'unknown'.`,
  );
  return 'unknown';
}
