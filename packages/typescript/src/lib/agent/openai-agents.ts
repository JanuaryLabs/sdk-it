import { spinalcase } from 'stringcase';

import {
  type IR,
  type OperationEntry,
  type TunedOperationObject,
  carriesBinary,
  forEachOperation,
  inputEndpoint,
  inputName,
  operationInputs,
} from '@sdk-it/spec';

import { type MakeImportFn } from '../import-utilities.ts';
import { inputSchemaName } from '../input-schema-name.ts';

export function generateOpenAIAgentTools(spec: IR, makeImport: MakeImportFn) {
  const groups: Record<string, string[]> = {};
  forEachOperation(spec, (entry, operation) => {
    groups[entry.tag] ??= [];
    groups[entry.tag].push(...createTools(spec, entry, operation));
  });
  const imports = [
    `import { z } from 'zod';`,
    `import { tool } from '@openai/agents';`,
    `import * as schemas from '${makeImport('./inputs/index')}';`,
  ];
  const tools = Object.entries(groups).map(([group, tools]) => {
    return `export const ${spinalcase(group)} = [${tools.join(', ')}];`;
  });

  return [...imports, ...tools].join('\n\n');
}

/**
 * One tool per input of `operation` that a JSON tool call can send: the
 * preferred input under the tool's own name, each variant under its encoding.
 */
function createTools(
  spec: IR,
  entry: OperationEntry,
  operation: TunedOperationObject,
) {
  const endpoint = `${entry.method.toUpperCase()} ${entry.path}`;
  return operationInputs(spec, operation)
    .filter((input) => !carriesBinary(spec, input))
    .map(
      (input) => `tool({
      description: \`${operation.description || operation.summary}\`,
      name: '${inputName(operation['x-fn-name'], input)}',
      parameters: makeOptionalPropsNullable(schemas.${inputSchemaName(operation.operationId, input)}),
			execute: async (input, maybeContext) => {
        const context = coerceContext(maybeContext?.context);
        const client = context.client;
        const response = await client.request(
          '${inputEndpoint(endpoint, input)}' ,
          input as any,
        );
        return JSON.stringify(response);
      },
    })`,
    );
}
