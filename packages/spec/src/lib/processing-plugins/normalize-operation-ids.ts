import { iterateOperations } from '../for-each-operation.js';
import { toResource } from '../guess/guess-resource.js';
import type { ProcessingPlugin } from '../processing.js';

function findUniqueOperationId(
  usedOperationIds: Set<string>,
  initialId: string,
  choices: string[],
  formatter: (id: string) => string,
) {
  let counter = 1;
  let uniqueOperationId = formatter(initialId);

  while (usedOperationIds.has(uniqueOperationId)) {
    const prependIndex = Math.min(counter - 1, choices.length - 1);
    const prefix = choices[prependIndex];
    uniqueOperationId = formatter(
      prependIndex < choices.length - 1
        ? `${prefix}${initialId.charAt(0).toUpperCase() + initialId.slice(1)}`
        : `${prefix}${initialId.charAt(0).toUpperCase() + initialId.slice(1)}${counter - choices.length + 1}`,
    );
    counter++;
  }

  return uniqueOperationId;
}

function normalizeOperationIdentifier(value: string): string {
  const normalized = value
    .trim()
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .replace(/(?:^|\s+)([A-Za-z0-9])/g, (_, character: string) =>
      character.toUpperCase(),
    )
    .replace(/^([A-Z])/, (character) => character.toLowerCase());

  if (!normalized) {
    return 'operation';
  }
  if (/^[A-Za-z]/.test(normalized)) {
    return normalized;
  }
  return `operation${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`;
}

export function normalizeOperationIds(): ProcessingPlugin {
  return {
    name: 'normalize-operation-ids',
    process({ spec, options, report }) {
      const usedOperationIds = new Set<string>();
      for (const { entry, operation } of iterateOperations(spec)) {
        const originalOperationId = operation.operationId;
        const { name } = toResource(operation, entry.path, entry.method);
        const operationTag = options.tag(operation, entry.path);
        const operationId = findUniqueOperationId(
          usedOperationIds,
          normalizeOperationIdentifier(
            options.operationId(operation, entry.path, entry.method),
          ),
          [
            operationTag,
            entry.method,
            entry.path.split('/').filter(Boolean).join(''),
          ],
          (candidate) =>
            normalizeOperationIdentifier(
              options.operationId(
                { ...operation, operationId: candidate },
                entry.path,
                entry.method,
              ),
            ),
        );
        usedOperationIds.add(operationId);
        operation.operationId = operationId;
        operation['x-fn-name'] = name;
        if (operationId !== originalOperationId) {
          report({
            severity: 'info',
            code: 'operation-id-normalized',
            message: `Normalized operation ID ${originalOperationId ?? '<missing>'} to ${operationId}`,
            path: `${entry.method.toUpperCase()} ${entry.path}`,
          });
        }
      }
    },
  };
}
