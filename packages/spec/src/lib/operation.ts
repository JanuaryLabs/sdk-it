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
export type Operation = {
  entry: OperationEntry;
  operation: TunedOperationObject;
};

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

// --- Function Definition (determineGenericTag, sanitizeTag, reservedKeywords, commonVerbs) ---
/**
 * Set of reserved TypeScript keywords and common verbs potentially used as tags.
 */
const reservedKeywords = new Set([
  'abstract',
  'arguments',
  'await',
  'boolean',
  'break',
  'byte',
  'case',
  'catch',
  'char',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'double',
  'else',
  'enum',
  'eval',
  'export',
  'extends',
  'false',
  'final',
  'finally',
  'float',
  'for',
  'function',
  'goto',
  'if',
  'implements',
  'import',
  'in',
  'instanceof',
  'int',
  'interface',
  'let',
  'long',
  'native',
  'new',
  'null',
  'package',
  'private',
  'protected',
  'public',
  'return',
  'short',
  'static',
  'super',
  'switch',
  'synchronized',
  'this',
  'throw',
  'throws',
  'transient',
  'true',
  'try',
  'typeof',
  'var',
  'void',
  'volatile',
  'while',
  'with',
  'yield',
  // Potentially problematic identifiers / Common Verbs used as tags
  'object',
  'string',
  'number',
  'any',
  'unknown',
  'never',
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
  'make', // Added make, check
]);

/**
 * Sanitizes a potential tag name (assumed to be already camelCased)
 * to avoid conflicts with reserved keywords or invalid starting characters (numbers).
 * Appends an underscore if the tag matches a reserved keyword.
 * Prepends an underscore if the tag starts with a number.
 * @param camelCasedTag The potential tag name, already camelCased.
 * @returns The sanitized tag name.
 */
function sanitizeTag(camelCasedTag: string): string {
  // Prepend underscore if starts with a number
  if (/^\d/.test(camelCasedTag)) {
    return `_${camelCasedTag}`;
  }
  // Append underscore if it's a reserved keyword
  return reservedKeywords.has(camelCasedTag)
    ? `${camelCasedTag}_`
    : camelCasedTag;
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
    'make', // Added make
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
  statusCode = Number(statusCode);
  return statusCode >= 200 && statusCode < 300;
}
