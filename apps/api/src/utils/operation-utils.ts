import { type IR, forEachOperation } from '@sdk-it/spec';

export function toOperations(spec: IR) {
  return forEachOperation(
    spec,
    (entry, operation) => [entry, operation] as const,
  );
}

export const availableOperations = (
  operations: ReturnType<typeof toOperations>,
) =>
  operations
    .map(
      ([entry, operation]) =>
        `operationId: operation_${operation.operationId}\nsdk style: '${entry.method.toUpperCase()} ${entry.path}' \nmethod: ${entry.method} http method\nendpoint: ${entry.path}\nsummary: ${operation.summary || 'N/A'}\ndescription: ${operation.description || 'N/A'}`,
    )
    .join('\n')
    .trim();

export function findOperationById(
  operations: ReturnType<typeof toOperations>,
  operationId: string,
) {
  const name = operationId.split('operation_')[1];
  if (!name) {
    return `Invalid operation ID format. Expected format: operation_<operationId>. Received: ${operationId}`;
  }
  for (const [entry, operation] of operations) {
    if (operation.operationId === name) {
      return { entry, operation };
    }
  }
  return `Operation with ID: ${operationId} does not exist.`;
}
