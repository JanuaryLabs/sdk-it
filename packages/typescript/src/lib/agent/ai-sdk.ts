import type { TagObject } from 'openapi3-ts/oas32';

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
      definition: TagObject;
    }
  > = {};
  forEachOperation(ir, (entry, operation) => {
    const tagDef = ir.tags.find((tag) => tag.name === entry.tag);
    if (!tagDef) {
      // normalize-tags gives every operation's tag a definition.
      throw new Error(`The IR defines no tag ${entry.tag}`);
    }

    groups[entry.tag] ??= { tools: [], definition: tagDef };
    groups[entry.tag].tools.push(...createTools(ir, entry, operation));
  });
  const imports = [
    `import { z } from 'zod';`,
    `import { tool } from 'ai';`,
    `import * as schemas from '${makeImport('./inputs/index')}';`,
  ];
  // Each group is ToolLoopAgent settings: new ToolLoopAgent({ model, ...group }).
  const agent = Object.entries(groups).map(([group, { tools, definition }]) => {
    const { id, instructions } = agentSettings(definition);
    const instructionsLine =
      instructions === undefined
        ? ''
        : `\n    instructions: ${JSON.stringify(instructions)},`;
    return `export const ${groupIdentifier(group)} = {
    id: ${JSON.stringify(id)},${instructionsLine}
    tools: { ${tools.join(', ')} },
    };`;
  });

  return [...imports, ...agent].join('\n\n');
}

/** A group's agent id and instructions: the tag's x-name, else its display name, and its x-instructions, else its description. rpc's toAgents repeats this rule. */
function agentSettings(definition: TagObject) {
  const id: string =
    definition['x-name'] ?? definition.summary ?? definition.name;
  const instructions: string | undefined =
    definition['x-instructions'] ?? definition.description;
  return { id, instructions };
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
