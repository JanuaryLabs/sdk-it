import { Agent, run, tool, withTrace } from '@openai/agents';
import { execa } from 'execa';
import { writeFile } from 'node:fs/promises';
import { z } from 'zod';

import { distillRef } from '@sdk-it/core';
import { type OurOpenAPIObject, augmentSpec, loadSpec } from '@sdk-it/spec';
import { TypeScriptSnippet } from '@sdk-it/typescript';

import { findOperationById, toOperations } from '../utils/operation-utils.ts';

function coerceContext(context?: any) {
  if (!context) {
    throw new Error('Context is required');
  }
  return context as {
    spec: OurOpenAPIObject;
    operations: ReturnType<typeof toOperations>;
  };
}

export const generateSnippet = tool({
  name: 'generateSnippet',
  description:
    'Generate a code snippet in TypeScript for the specified operation ID and parameters. This is the final step for generating code.',
  strict: true,
  parameters: z.object({
    operationId: z
      .string()
      .describe('The operation ID to generate a snippet for.'),
    requestBody: z
      .string()
      .default('{}')
      .describe(
        'JSON stringified operation body to be passed in the request. Only if needed.',
      ),
    queryParameters: z
      .string()
      .default('{}')
      .describe('JSON stringified object of query parameters. Only if needed.'),
    pathParameters: z
      .string()
      .default('{}')
      .describe('JSON stringified object of path parameters. Only if needed.'),
  }),
  execute: async (
    { operationId, requestBody, queryParameters, pathParameters },
    maybeContext,
  ) => {
    console.log(`[Tool Call] generateSnippet for ${operationId}`);
    const context = coerceContext(maybeContext?.context);
    const spec = context.spec as OurOpenAPIObject;
    const generator = new TypeScriptSnippet(spec, { output: '' });
    const operation = findOperationById(context.operations, operationId);
    if (typeof operation === 'string') {
      return operation;
    }

    const snippet = generator.succinct(operation.entry, operation.operation, {
      requestBody: JSON.parse(requestBody),
      queryParameters: JSON.parse(queryParameters),
      pathParameters: JSON.parse(pathParameters),
    });

    return (
      [generator.client(), snippet.content, snippet.footer].join('\n\n') + '\n'
    );
  },
});

export const getOperationsDetails = tool({
  name: 'getOperationsDetails',
  description: 'Get details for a list of operation IDs from the OpenAPI spec.',
  strict: true,
  parameters: z.object({
    operationIds: z
      .array(z.string())
      .describe(
        'An array of operation IDs prefixed with "operation_" to look up.',
      ),
  }),
  execute: async ({ operationIds }, maybeContext) => {
    const context = coerceContext(maybeContext?.context);
    console.log(
      `[Tool Call] getOperationsDetails for ${operationIds.join(', ')}`,
    );
    const details = (operationIds as any[])
      .map((id) => findOperationById(context.operations, id))
      .map((result) => {
        if (typeof result === 'string') return { error: result };
        return {
          operationId: result.operation.operationId,
          summary: result.operation.summary,
          description: result.operation.description,
          method: result.entry.method,
          path: result.entry.path,
          parameters: result.operation.parameters,
          requestBody: result.operation.requestBody,
        };
      });
    return JSON.stringify(details);
  },
});

export const getSchemaDefinition = tool({
  name: 'getSchemaDefinition',
  description:
    'Get the JSON schema definition for a given component reference path.',
  parameters: z.object({
    ref: z
      .string()
      .describe('The reference path, e.g., "#/components/schemas/User".'),
  }),
  execute: async (input, maybeContext) => {
    const context = coerceContext(maybeContext?.context);
    console.log(`[Tool Call] getSchemaDefinition for ${input.ref}`);
    const spec = context.spec as OurOpenAPIObject;
    const definition = distillRef(spec, input.ref);
    if (!definition) {
      return `Schema not found for ref: ${input.ref}`;
    }
    return JSON.stringify(definition);
  },
});

/**
 * @description This agent's responsibility is to brainstorm use cases.
 * It now outputs a description for each use case, which is critical for the next step.
 */
export const useCaseAgent = Agent.create({
  name: 'UseCasesGenerator',
  instructions: `You are an expert in API design. Given an OpenAPI operation, brainstorm up to 3 creative and practical use cases.
For each use case, provide a camelCase name and a short description of what it demonstrates (e.g., "filtering by a specific parameter" or "creating a user with the minimum required fields").`,
  outputType: z.object({
    useCases: z.array(
      z.object({
        name: z.string().describe('A camelCase use case name.'),
        description: z
          .string()
          .describe('A short description of the use case logic.'),
      }),
    ),
  }),
  model: 'gpt-4.1-nano',
  tools: [getSchemaDefinition],
});

/**
 * @description This agent's single responsibility is to generate one snippet.
 * It takes the use case description and figures out how to call the `generateSnippet` tool.
 */
export const snippetAgent = Agent.create({
  name: 'SnippetGenerator',
  instructions: `You are a code generation expert. Your task is to generate a single TypeScript code snippet for a specific use case.
You will be given an operation's details and a use case description.
Your ONLY job is to call the \`generateSnippet\` tool with the correct parameters (requestBody, queryParameters, etc.) to fulfill the use case.
Use the other available tools to understand the operation's schema if needed.
Do not add any commentary. Your final output must be the code from the 'generateSnippet' tool call without markdown or any other formatting.

Note: operationId is the operation's ID prefixed with "operation_". For example, "operation_listDoctors" for the "listDoctors" operation.
`,
  tools: [generateSnippet, getSchemaDefinition],
  model: 'gpt-4.1-nano',
});

const operationId = 'operation_listDoctors';

const spec = augmentSpec({
  spec: await loadSpec(
    '/Users/ezzabuzaid/Desktop/mo/virtual-care/openapi.json',
  ),
});

const operations = toOperations(spec);
const operationDetails = findOperationById(operations, operationId);

if (typeof operationDetails === 'string') {
  throw new Error(operationDetails);
}

const sharedContext = {
  context: {
    spec,
    operations,
  },
};
await withTrace('Snippet Generation Workflow', async () => {
  console.log(`\n--- STEP 1: Generating Use Cases for ${operationId} ---`);

  // --- Step 1: Generate a list of use cases ---
  const useCaseResult = await run(
    useCaseAgent,
    `Generate use cases for the following operation: ${JSON.stringify(
      operationDetails,
    )}`,
    sharedContext,
  );

  if (!useCaseResult.finalOutput?.useCases) {
    console.error('Failed to generate use cases.');
    return;
  }

  const { useCases } = useCaseResult.finalOutput;

  // --- Step 2: Loop through use cases and generate a snippet for each ---
  const finalReport: {
    lang: 'typescript';
    label: string;
    source: string;
  }[] = [];
  for (const useCase of useCases) {
    const snippetResult = await run(
      snippetAgent,
      `
      Operation: ${JSON.stringify(operationDetails)}
      Use Case Name: "${useCase.name}"
      Use Case Description: "${useCase.description}"

      Generate the code snippet for this specific use case.
      `,
      sharedContext,
    );

    if (snippetResult.finalOutput) {
      console.log('   ✅ Snippet Generated Successfully.');
      finalReport.push({
        lang: 'typescript',
        label: useCase.name,
        source: snippetResult.finalOutput,
      });
    } else {
      console.log('   ❌ Failed to generate snippet for this use case.');
    }
  }
  operationDetails.operation['x-codeSamples'] = finalReport;

  console.dir(finalReport, { depth: null });
});

await writeFile(
  '/Users/ezzabuzaid/Desktop/mo/virtual-care/openapi.json',
  JSON.stringify(spec),
  'utf-8',
);

await execa`npx @scalar/cli document serve /Users/ezzabuzaid/Desktop/mo/virtual-care/openapi.json`;
