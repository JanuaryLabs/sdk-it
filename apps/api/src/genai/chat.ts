import { google } from '@ai-sdk/google';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { type CoreMessage, smoothStream, streamText, tool } from 'ai';
import chalk from 'chalk';
import { z } from 'zod';

import type { OurOpenAPIObject } from '@sdk-it/spec';

import { database } from '../utils/db.js';
import { markdownJoinerTransform } from '../utils/markdown-joiner-transformer.js';
import { availableOperations, toOperations } from '../utils/operation-utils.js';
import { generateSnippetTool } from './tools/generate-snippet-tool.js';
import { getOperationsTool } from './tools/get-operations-tool.js';
import { getSchemaDefinition } from './tools/get-schema-difintion.js';

export function talk(
  spec: OurOpenAPIObject,
  conversationId: string,
  messages: CoreMessage[],
) {
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
    generateSnippet: generateSnippetTool(spec),
    getSchemaDefinition: getSchemaDefinition(spec),
    getOperations: getOperationsTool(spec),
  };

  const lmstudio = createOpenAICompatible({
    name: 'lmstudio',
    baseURL: 'http://localhost:1234/v1',
  });
  const operations = toOperations(spec);
  const result = streamText({
    experimental_transform: [
      smoothStream({ chunking: 'line', delayInMs: 100 }),
      markdownJoinerTransform(),
    ],
    model: google('gemini-2.5-flash-preview-05-20'),

    messages: [...messages],
    temperature: 0.1,
    topP: 0.5,
    // toolChoice: 'required',
    tools,
    maxSteps: 25, // Allow multiple steps of tool calls and responses

    // model: openai('gpt-4.1-nano'),
    // providerOptions: {
    //   openai: { service_tier: 'flex' },
    // },
    // model: lmstudio('qwen3-8b'),
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



## Available Operations
Here is a list of available operations you can use. Remember to use \`getOperations\` for specifics before generating code.
\`\`\`
${availableOperations(operations)}
\`\`\`

Always generate code snippets using the \`generateSnippet\` tool no matter what the user asks.
`,
    onError(event) {
      console.error('Error:', event.error);
    },
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
