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

import { groupIdentifier } from '../group-identifier.ts';
import { type MakeImportFn } from '../import-utilities.ts';
import { inputSchemaName } from '../input-schema-name.ts';

export function generateAISDKTools(ir: IR, makeImport: MakeImportFn) {
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
    groups[entry.tag].tools.push(...createTools(ir, entry, operation));
    groups[entry.tag].instructions = tagDef['x-instructions'];
    groups[entry.tag].name = tagDef.name;
    groups[entry.tag].displayName = tagDef['x-name'];
  });
  const imports = [
    `import { z } from 'zod';`,
    `import { tool } from 'ai';`,
    `import * as schemas from '${makeImport('./inputs/index')}';`,
  ];
  const agent = Object.entries(groups).map(
    ([group, { instructions, tools, displayName }]) => {
      return `export const ${groupIdentifier(group)} = {
    name: '${displayName}',
    instructions: \`${instructions}\`,
    tools: { ${tools.join(', ')} }
    }`;
    },
  );

  return [...imports, ...agent].join('\n\n');
}

/**
 * One tool per input of `operation` that a JSON tool call can send: the
 * preferred input under the tool's own name, each variant under its encoding.
 */
function createTools(
  ir: IR,
  entry: OperationEntry,
  operation: TunedOperationObject,
) {
  const toolInfo = operation['x-tool'];
  const name = toolInfo?.name || operation['x-fn-name'];
  const endpoint = `${entry.method.toUpperCase()} ${entry.path}`;
  return operationInputs(ir, operation)
    .filter((input) => !carriesBinary(ir, input))
    .map(
      (input) => `'${inputName(name, input)}': tool({
      description: \`${toolInfo?.description || operation.description || operation.summary}\`,
      inputSchema: schemas.${inputSchemaName(operation.operationId, input)},
			execute: async (input, options) => {
        const context = coerceContext(options.context);
        const response = await context.client.request(
          '${inputEndpoint(endpoint, input)}' ,
          input,
        );
        return JSON.stringify(response);
      },
    })`,
    );
}
