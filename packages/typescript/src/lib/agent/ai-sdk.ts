import { camelcase } from 'stringcase';

import {
  type IR,
  type OperationEntry,
  type TunedOperationObject,
  forEachOperation,
} from '@sdk-it/spec';

export function generateAISDKTools(ir: IR) {
  const groups: Record<
    string,
    {
      tools: string[];
      instructions: string;
      displayName: string;
      name: string;
    }
  > = {};
  forEachOperation(ir, (entry, operation) => {
    const tagDef = ir.tags.find((tag) => tag.name === entry.tag);
    if (!tagDef) {
      console.warn(`No tag details found for tag: ${entry.tag}`);
      return;
    }

    groups[entry.tag] ??= {
      tools: [],
      instructions: '',
      displayName: '',
      name: '',
    };
    groups[entry.tag].tools.push(createTool(entry, operation));
    groups[entry.tag].instructions = tagDef['x-instructions'];
    groups[entry.tag].name = tagDef.name;
    groups[entry.tag].displayName = tagDef['x-name'];
  });
  const imports = [
    `import { z } from 'zod';`,
    `import { tool } from 'ai';`,
    `import * as schemas from './inputs/index.ts';`,
  ];
  const agent = Object.entries(groups).map(
    ([group, { instructions, tools, displayName }]) => {
      return `export const ${camelcase(group)} = {
    name: '${displayName}',
    instructions: \`${instructions}\`,
    tools: { ${tools.join(', ')} }
    }`;
    },
  );
  const handoffs = `export const triage = {
  name: 'Triage Agent',
  tools:{${Object.entries(groups).map(([, { name }]) => {
    return createTransferTool(name);
  })}}}`;

  return [...imports, ...agent, handoffs].join('\n\n');
}

function createTool(entry: OperationEntry, operation: TunedOperationObject) {
  const schemaName = camelcase(`${operation.operationId} schema`);
  return `'${operation['x-fn-name']}': tool({
      description: \`${operation.description || operation.summary}\`,
      inputSchema: schemas.${schemaName},
			execute: async (input, options) => {
				console.log('Executing ${operation.operationId} tool with input:', input);
        const context = coerceContext(options.experimental_context);
        const response = await context.client.request(
          '${entry.method.toUpperCase()} ${entry.path}' ,
          input,
        );
        return JSON.stringify(response);
      },
    })`;
}

function createTransferTool(agentName: string) {
  return `transfer_to_${agentName}: tool({
      type: 'function',
      description: 'Transfer the conversation to the ${agentName}.',
      inputSchema: z.object({}),
      execute: async () => ({ agent: '${agentName}' }),
    })`;
}
