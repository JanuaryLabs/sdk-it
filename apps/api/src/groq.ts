import { anthropic } from '@ai-sdk/anthropic';
import { google } from '@ai-sdk/google';
import { groq } from '@ai-sdk/groq';
import { openai } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import {
  type CoreMessage,
  type TextStreamPart,
  type ToolCallUnion,
  type ToolResultUnion,
  createIdGenerator,
  generateId,
  smoothStream,
  streamText,
  tool,
} from 'ai';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { z } from 'zod';

import { distillRef } from '@sdk-it/core';

import { database } from './db.js';
import {
  availableOperations,
  findOperationById,
  generator,
  spec,
} from './init.js';

const tools = {
  // craftPlan: tool({
  //   description:
  //     'Use this tool to create a plan if the user inquery/question is not sufficient. It will not obtain new information or make any changes to the repository, but just log the plan. Use it when you need to outline your next steps or actions.',
  //   parameters: z.object({
  //     plan: z.string().describe('Your plan.'),
  //   }),
  //   execute: async (args) => {
  //     console.log('\n📝 CRAFTING PLAN:', args.plan);
  //     return `My plan is ${args.plan}. I will proceed with the next steps.`;
  //     // return "I've noted this plan. Proceed with your reasoning or actions.";
  //   },
  // }),
  createTodo: tool({
    description:
      'Create a TODO item in the repository. It will not obtain new information or make any changes to the repository, but just log the TODO item. Use it when you need to outline your next steps or actions.',
    parameters: z.object({
      todoList: z.string().describe('Your TODO list.'),
    }),
    execute: async (args) => {
      console.log('\n📝 CREATING TODO:', args.todoList);
      return `My TODO list is ${args.todoList}. I will proceed with the next steps.`;
      // return "I've noted this plan. Proceed with your reasoning or actions.";
    },
  }),
  // think: tool({
  //   description:
  //     'Use the tool to think about something. It will not obtain new information or make any changes to the repository, but just log the thought. Use it when complex reasoning or brainstorming is needed. For example, if you explore the repo and discover the source of a bug, call this tool to brainstorm several unique ways of fixing the bug, and assess which change(s) are likely to be simplest and most effective. Alternatively, if you receive some test results, call this tool to brainstorm ways to fix the failing tests.',
  //   parameters: z.object({
  //     thought: z.string().describe('Your thoughts.'),
  //   }),
  //   execute: async (args) => {
  //     console.log('\n🤔 THINKING:', args.thought);
  //     // return "I've processed this thought. Continue with your reasoning or proceed to action.";
  //     return "I've processed this thought. Proceed to action.";
  //   },
  // }),
  generateSnippet: tool({
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
      const operation = findOperationById(args.operationId);
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
  }),
  getSchemaDefinition: tool({
    description: 'Get the schema definition for a given reference path.',
    parameters: z.object({
      ref: z
        .string()
        .describe(
          'The complete reference path starting with a hash (e.g., "#/components/schemas/ModelName").',
        ),
    }),
    execute: async (args) => {
      console.log('Fetching schema definition for:', args.ref);
      const def = distillRef(spec, args.ref);
      if (!def) {
        return `Schema definition not found for: ${args.ref}`;
      }
      return JSON.stringify(def);
    },
  }),
  getOperations: tool({
    description: 'Find list of operation in the OpenAPI spec.',
    parameters: z.object({
      operationsIds: z
        .string()
        .or(z.array(z.string()))
        .describe('Comma seperated list of  operations IDs to find.'),
    }),
    execute: async (args) => {
      const operations = Array.isArray(args.operationsIds)
        ? args.operationsIds
        : args.operationsIds.split(',').map((id) => id.trim());
      if (operations.length === 1 && operations[0] === '*') {
        return 'Using * to find all operations will break the server. Please provide a list of operation IDs.';
      }
      console.log('Finding operation with ID:', operations);
      return JSON.stringify(
        operations
          .map((id) => id.trim())
          .map((id) => findOperationById(id))
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
  }),
};
type MyToolCall = ToolCallUnion<typeof tools>;
type MyToolResult = ToolResultUnion<typeof tools>;

const lmstudio = createOpenAICompatible({
  name: 'lmstudio',
  baseURL: 'http://localhost:1234/v1',
});
export function talk(conversationId: string, messages: CoreMessage[]) {
  const result = streamText({
    experimental_transform: smoothStream({ chunking: 'line' }),
    model: openai('o4-mini'),
    providerOptions: {
      openai: { service_tier: 'flex' },
    },
    // model: groq('meta-llama/llama-4-scout-17b-16e-instruct'),
    // model: lmstudio('qwen3-8b'),
    // model: google('gemini-2.5-flash-preview-05-20'),
    // model: anthropic('claude-4-sonnet-20250514'),
    system: `
# Role and Objective

You are a specialized AI assistant designed to help users understand and interact with an API defined by an OpenAPI specification, using a generated TypeScript SDK. Your primary objective is to provide accurate information and functional code snippets based **strictly** on the provided API specification and tool outputs. Accuracy and adherence to the specified workflow are paramount.

# Instructions

## General Guidance
- Prioritize accuracy above all else. Rely *only* on the provided API specification details retrieved via tools.
- Maintain a professional and helpful tone.

## Prohibited Actions
- Do not generate code snippets or explain operation specifics based on assumptions, memory, or the initial list of available operations. Your knowledge is incomplete until \`getOperations\` provides details.
- Do not answer questions outside the scope of the provided API specification.

# Reasoning Steps (Workflow)

Follow these steps precisely for every user request:

1.  **Planing**: **For any request requiring code generation or specific operation details, your first action must be to generate a step-by-step plan using "createTodo" tool.**
1.  **Query Analysis:** Break down the user's request to understand the core intent. Identify what API operation(s) might be relevant.
2.  **Verification Check:** Determine if fulfilling the request requires generating a code snippet for a specific operation OR explaining its detailed parameters, request body, or response structure.
3.  **Mandatory Tool Call (If Verification Check is YES):**
    a. Announce your plan to call \`getOperations\` for the specific operation ID.
    b. **Call the \`getOperations\` tool.**
    c. Wait for the tool's output. Analyze the retrieved operation details.
4.  **Response Generation:**
    a. If step 3 was performed, explicitly state that you are using the verified information from \`getOperations\`.
    b. Generate the final response, code snippet (using verified details), or explanation according to the Output Format guidelines.
    c. If step 3 was not required (e.g., a general question), generate the response based on available information (like the operation list for summaries).

# Context

## API Client Construction
Use the following pattern to construct the client:
\`\`\`typescript
${generator.client()}
\`\`\`

## Available Operations
Here is a list of available operations you can use. Remember to use \`getOperations\` for specifics before generating code.
\`\`\`
${availableOperations}
\`\`\`

Always generate code snippets using the \`generateSnippet\` tool no matter what the user asks.
`,
    messages: [...messages],
    temperature: 0,
    topP: 0.5,
    // toolChoice: 'required',
    tools,
    maxSteps: 25, // Allow multiple steps of tool calls and responses
    onError(event) {
      console.error('Error:', event.error);
    },
    // experimental_generateMessageId: createIdGenerator({
    //   prefix: 'msgs',
    //   size: 16,
    // }),

    onStepFinish: async ({ text, toolCalls, toolResults }) => {
      // 2. Print to console
      if (text) {
        console.log(`\n${chalk.red('[Bot  ]')} ${text}`);
        database.data.push({
          conversationId,
          role: 'assistant',
          content: text,
        });
      }
      toolCalls.forEach((call, i) => {
        console.log(
          `\n→ ${chalk.blue('Tool:')} ${call.toolName}(${JSON.stringify(call.args)})`,
        );
        console.log(
          `\n  ↳ ${chalk.green('Result:')} ${JSON.stringify(toolResults[i])}`,
        );
        database.data.push({
          conversationId,
          type: 'tool-call',
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          args: call.args,
        });
      });
      toolResults.forEach((result) => {
        database.data.push({
          role: 'tool',
          conversationId,
          content: [
            {
              type: 'tool-result',
              result: result.result,
              toolCallId: result.toolCallId,
              toolName: result.toolName,
            },
          ],
        });
      });
      await database.write();
    },
  });
  result.consumeStream({
    onError: (error) => {
      console.log('Error during background stream consumption: ', error); // optional error callback
    },
  });
  return result;
}
