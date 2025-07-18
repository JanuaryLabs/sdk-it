import { tool } from 'ai';
import { z } from 'zod';

import type { IR } from '@sdk-it/spec';

import {
  findOperationById,
  toOperations,
} from '../../utils/operation-utils.ts';

export function getOperationsTool(spec: IR) {
  const operations = toOperations(spec);
  return tool({
    description: 'Find list of operation in the OpenAPI spec.',
    parameters: z.object({
      operationsIds: z
        .string()
        .or(z.array(z.string()))
        .describe('Comma seperated list of  operations IDs to find.'),
    }),
    execute: async (args) => {
      const operationsIds = Array.isArray(args.operationsIds)
        ? args.operationsIds
        : args.operationsIds.split(',').map((id) => id.trim());
      if (operationsIds.length === 1 && operationsIds[0] === '*') {
        return 'Using * to find all operations will break the server. Please provide a list of operation IDs.';
      }
      console.log('Finding operation with ID:', operationsIds);
      return JSON.stringify(
        operationsIds
          .map((id) => id.trim())
          .map((id) => findOperationById(operations, id))
          .map((result) => {
            if (typeof result === 'string') {
              return result;
            }
            return {
              operationId: result.operation.operationId,
              method: result.entry.method,
              parameters: result.operation.parameters,
              path: result.entry.path,
              requestBody: result.operation.requestBody,
              description: result.operation.description,
              summary: result.operation.summary,
            };
          }),
      );
    },
  });
}
