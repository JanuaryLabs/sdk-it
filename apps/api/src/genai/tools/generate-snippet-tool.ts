import { tool } from 'ai';
import { z } from 'zod';

import type { IR } from '@sdk-it/spec';
import { TypeScriptSnippet } from '@sdk-it/typescript';

import {
  findOperationById,
  toOperations,
} from '../../utils/operation-utils.js';

export function generateSnippetTool(spec: IR) {
  return tool({
    description:
      'Generate a code snippet in TypeScript for the specified operation ID. ',
    parameters: z.object({
      operationId: z
        .string()
        .describe('The operation ID to generate a snippet for.'),
      requestBody: z
        .string()
        .default('{}')
        .describe(
          'JSON stringifed opereation body to be passed in the request. only if needed.',
        ),
      queryParameters: z
        .string()
        .default('{}')
        .describe(
          'JSON stringifed object of query parameters to be passed in the request. only if needed.',
        ),
      pathParameters: z
        .string()
        .default('{}')
        .describe(
          'JSON stringifed object of path parameters to be passed in the request. only if needed.',
        ),
      headers: z
        .string()
        .default('{}')
        .describe(
          'JSON stringifed object of headers to be passed in the request. only if needed.',
        ),
      cookies: z
        .string()
        .default('{}')
        .describe(
          'JSON stringifed object of cookies to be passed in the request. only if needed.',
        ),
    }),
    execute: async (args) => {
      // FIXME: generate the snippet with providede values
      // otherwise the model keep repeating the same tool call

      console.log(
        'Generating snippet for operation with ID:',
        'operationId',
        args.operationId,
        'requestBody',
        args.requestBody,
        'queryParameters',
        args.queryParameters,
        'pathParameters',
        args.pathParameters,
      );
      const generator = new TypeScriptSnippet(spec, { output: '' });
      const operations = toOperations(spec);
      const operation = findOperationById(operations, args.operationId);
      if (typeof operation === 'string') {
        return operation;
      }
      return generator.succinct(operation.entry, operation.operation, {
        requestBody: JSON.parse(args.requestBody || '{}'),
        queryParameters: JSON.parse(args.queryParameters || '{}'),
        pathParameters: JSON.parse(args.pathParameters || '{}'),
        headers: JSON.parse(args.headers || '{}'),
        cookies: JSON.parse(args.cookies || '{}'),
      });
    },
  });
}
