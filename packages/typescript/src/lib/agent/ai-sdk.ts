import { camelcase, spinalcase } from 'stringcase';

import {
  type OperationEntry,
  type OurOpenAPIObject,
  type TunedOperationObject,
  forEachOperation,
} from '@sdk-it/spec';

export function generateAISDKTools(spec: OurOpenAPIObject) {
  const groups: Record<string, string[]> = {};
  forEachOperation(spec, (entry, operation) => {
    groups[entry.tag] ??= [];
    groups[entry.tag].push(createTool(entry, operation));
  });
  const imports = [
    `import { z } from 'zod';`,
    `import { tool } from 'ai';`,
    `import * as schemas from './inputs/index.ts';`,
  ];
  const tools = Object.entries(groups).map(([group, tools]) => {
    return `export const ${spinalcase(group)} = (context: { client: any }) => ({ ${tools.join(', ')} });`;
  });

  return [...imports, ...tools].join('\n\n');
}

function createTool(entry: OperationEntry, operation: TunedOperationObject) {
  const schemaName = camelcase(`${operation.operationId} schema`);
  return `'${operation['x-fn-name']}': tool({
      description: \`${operation.description || operation.summary}\`,
			type: 'function',
      inputSchema: schemas.${schemaName},
			execute: async (input) => {
				console.log('Executing ${operation.operationId} tool with input:', input);
        const client = context.client;
        const response = await client.request(
          '${entry.method.toUpperCase()} ${entry.path}' ,
          input as any,
        );
        return JSON.stringify(response);
      },
    })`;
}
