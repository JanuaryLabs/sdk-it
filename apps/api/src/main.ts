/* eslint-disable @typescript-eslint/no-explicit-any */
import { Hono } from 'hono';
import inquirer from 'inquirer';
import { marked } from 'marked';
import { markedTerminal } from 'marked-terminal';
import { readFile, writeFile } from 'node:fs/promises';
import { OpenAI } from 'openai';
import type {
  FunctionTool,
  ResponseInput,
} from 'openai/resources/responses/responses.mjs';
import { z } from 'zod';

import { distillRef } from '@sdk-it/core';
import { forEachOperation } from '@sdk-it/spec';
import { loadSpec } from '@sdk-it/spec/loaders/load-spec.js';
import { TypeScriptGenerator } from '@sdk-it/typescript';

const openai = new OpenAI();

const app = new Hono();
app.get('/', (c) => c.text('Hello Node.js!'));
// console.log();
// serve(app, (addressInfo) => {
//   console.log(`Server is running on http://localhost:${addressInfo.port}`);
// });

const spec = await loadSpec(
  // '/Users/ezzabuzaid/Desktop/January/sdk-it/.yamls/openstatus.json',
  'https://raw.githubusercontent.com/openai/openai-openapi/refs/heads/master/openapi.yaml',
);
await writeFile('openapi.json', JSON.stringify(spec), 'utf-8');
const generator = new TypeScriptGenerator(spec, { output: '' });
console.log('Loaded spec:', spec.info.title, spec.info.version);
const operations = forEachOperation(
  { spec },
  (entry, operation) => [entry, operation] as const,
);

type ToolExecutor<T> = (args: T) => Promise<unknown>;
type ToolDefinition<T> = FunctionTool & { execute: ToolExecutor<T> };

function tool<T>(spec: {
  name: string;
  description: string;
  parameters: z.ZodType<T>;
  execute: ToolExecutor<T>;
}): ToolDefinition<T> {
  const jsonSchema = z.toJSONSchema(spec.parameters, { reused: 'inline' });
  return {
    strict: true,
    type: 'function',
    name: spec.name,
    description: spec.description,
    // Make sure parameters is just the schema object, not the whole definition
    parameters: jsonSchema.properties
      ? { ...jsonSchema, additionalProperties: false }
      : { type: 'object', properties: {} },
    execute: spec.execute,
  };
}

const availableOperations = operations
  .map(
    ([entry, operation]) =>
      `operationId: operation_${operation.operationId}\nmethod: ${entry.method} http method\nendpoint: ${entry.path}\nsummary: ${operation.summary || 'N/A'}\ndescription: ${operation.description || 'N/A'}`,
  )
  .join('\n')
  .trim();

class Convo {
  #tools: ToolDefinition<any>[] = [];

  #inputTokenCounter = 0;
  #outputTokenCounter = 0;

  constructor(tools: ToolDefinition<any>[]) {
    this.#tools = tools ?? [];
  }

  async #think(
    response: OpenAI.Responses.Response,
  ): Promise<OpenAI.Responses.Response> {
    const input: ResponseInput = [];

    console.log('Thinking...', response.output);
    for (const output of response.output) {
      if (output.type === 'function_call') {
        const args = JSON.parse(output.arguments);
        const toolSpec = this.#tools.find((tool) => tool.name === output.name);

        if (!toolSpec) {
          console.error(`   - Error: Tool "${output.name}" not found.`);
          input.push({
            call_id: output.call_id as string,
            type: 'function_call_output',
            output: `Tool "${output.name}" not found.`,
          });
          continue;
        }
        try {
          console.log(`   - Executing: ${toolSpec.name}...`);
          const result = await toolSpec.execute(args);
          input.push({
            call_id: output.call_id as string,
            type: 'function_call_output',
            output: result as string,
          });
        } catch (error: unknown) {
          console.error(`   - Error executing tool "${output.name}":`);
          console.error(error);
          input.push({
            call_id: output.call_id as string,
            type: 'function_call_output',
            output: JSON.stringify({
              error: `Error executing tool "${output.name}": ${JSON.stringify(
                error,
              )}`,
            }),
          });
        }
      }
    }
    if (input.length === 0) {
      console.log('   - No function calls to process.');
      return response;
    }

    return this.talk(input, response.id);
  }

  async talk(
    message: ResponseInput | string,
    previous_response_id?: string | null,
  ): Promise<OpenAI.Responses.Response> {
    const response = await openai.responses.create({
      model: 'gpt-4.1-nano',
      input: message,
      tools: [
        {
          // FIXME: Vectorising json directly is not producing good result
          // instead generate readme.md from the spec and vectorise it
          type: 'file_search',
          vector_store_ids: ['vs_6811cd14ce408191b504bef45808aed1'],
        },
        ...this.#tools,
      ],
      stream: false,
      top_p: 0.25,
      previous_response_id,
      store: true,
      temperature: 0,
      instructions: `
# Role and Objective

You are a specialized AI assistant designed to help users understand and interact with an API defined by an OpenAPI specification, using a generated TypeScript SDK. Your primary objective is to provide accurate information and functional code snippets based **strictly** on the provided API specification and tool outputs. Accuracy and adherence to the specified workflow are paramount.

# Instructions

## General Guidance
- Prioritize accuracy above all else. Rely *only* on the provided API specification details retrieved via tools.
- Maintain a professional and helpful tone.

## Tool Usage (CRITICAL)
- **Mandatory Verification:** You **MUST** use the \`getOperation\` tool to retrieve the exact details (parameters, request body, etc.) of an API operation **BEFORE** you generate a code snippet for it OR explain its specific details.
- **No Guessing:** If you are unsure about any detail regarding an API operation (its parameters, structure, or exact purpose), use the \`getOperation\` tool to get the facts. **DO NOT GUESS OR MAKE UP ANSWERS.**
- **Planning Before Tools:** Before calling any tool, briefly outline your plan or the reason for the tool call (you will be prompted to think step-by-step below).
- **Reflection After Tools:** After receiving output from a tool (especially \`getOperation\`), incorporate that information accurately into your next step or response.
- **Tool Failure/Ambiguity:** If \`getOperation\` fails or returns an error, or if the user's request is too ambiguous to confidently select an operation ID, use the \`requestHumanAssistance\` tool and explain the issue. Do not proceed with generating potentially incorrect information.

## Prohibited Actions
- Do not generate code snippets or explain operation specifics based on assumptions, memory, or the initial list of available operations. Your knowledge is incomplete until \`getOperation\` provides details.
- Do not answer questions outside the scope of the provided API specification.

# Reasoning Steps (Workflow)

Follow these steps precisely for every user request:

1.  **Planing**: **For any request requiring code generation or specific operation details, your first action must be to generate a step-by-step plan using "craftPlan" tool.**
1.  **Query Analysis:** Break down the user's request to understand the core intent. Identify what API operation(s) might be relevant.
2.  **Verification Check:** Determine if fulfilling the request requires generating a code snippet for a specific operation OR explaining its detailed parameters, request body, or response structure.
3.  **Mandatory Tool Call (If Verification Check is YES):**
    a. Announce your plan to call \`getOperation\` for the specific operation ID.
    b. **Call the \`getOperation\` tool.**
    c. Wait for the tool's output. Analyze the retrieved operation details.
    d. If the tool call fails or details are unexpected, reconsider your plan or use \`requestHumanAssistance\`.
4.  **Response Generation:**
    a. If step 3 was performed, explicitly state that you are using the verified information from \`getOperation\`.
    b. Generate the final response, code snippet (using verified details), or explanation according to the Output Format guidelines.
    c. If step 3 was not required (e.g., a general question), generate the response based on available information (like the operation list for summaries).

# Output Format

- Respond clearly and structurly.
- **Confirmation:** When providing a code snippet or detailed explanation based on \`getOperation\`'s output, **always** start by confirming you used the tool, e.g., "Okay, I have fetched the details for \`operation_xyz\` using \`getOperation\`. Based on the verified information:".
- **Code Snippets:**
    - Provide code snippets in TypeScript using the SDK.
    - Ensure snippets accurately reflect the operation's structure (path, method, parameters, body) as confirmed by \`getOperation\`.
    - Use the client construction pattern provided below.
- **Clarity:** If suggesting alternative operations, explain why the direct match wasn't found or suitable.

# Examples

## Example 1: Direct Request Requiring Verification

**User:** How do I create a user?

**Assistant Thought Process (Simulated):**
1. Intent: User wants to create a user.
2. Relevant Operation: Likely involves a POST to a user endpoint. Need to find the exact operationId. Assume it's \`operation_createUser\`.
3. Verification Check: YES - user needs a code snippet.
4. Mandatory Tool Call: Need to call \`getOperation\` for \`operation_createUser\`.

**Assistant Action:**
*Calls: \`getOperation({ operationId: 'operation_createUser' })\`*
*(Waits for tool result containing method: POST, path: /users, requestBody schema, etc.)*

**Assistant Response:**
"Okay, I have fetched the details for \`operation_createUser\` using \`getOperation\`. Based on the verified information (POST /users), here is how you can create a user:
\`\`\`typescript
const client = new Client({...});
// Assuming the request body requires 'name' based on getOperation result
const response = await client.request('POST /users', {
    name: 'John Doe'
});
\`\`\`"

## Example 2: Non-Direct Request Requiring Multiple Verifications

**User:** How to get products for each user?

**Assistant Thought Process (Simulated):**
1. Intent: User wants products for all users. Requires multiple steps.
2. Plan: First, list users. Second, for each user, list their products.
3. Operations: Need \`operation_listUsers\` and \`operation_listUserProducts\`.
4. Verification Check: YES - involves generating code based on these operations.
5. Mandatory Tool Calls: Must call \`getOperation\` for \`operation_listUsers\` AND \`getOperation\` for \`operation_listUserProducts\` before generating final code.

**Assistant Action:**
*Calls: \`getOperation({ operationId: 'operation_listUsers' })\`*
*(Gets result: GET /users)*
*Calls: \`getOperation({ operationId: 'operation_listUserProducts' })\`*
*(Gets result: GET /users/{userId}/products, requires path param \`userId\`)*

**Assistant Response:**
"Okay, to get products for each user, we need two steps. I've fetched the details using \`getOperation\` for both \`operation_listUsers\` (GET /users) and \`operation_listUserProducts\` (GET /users/{userId}/products). Based on this verified information:
1. First, list all users.
2. Then, loop through the users and get products for each user ID.

Here's the code:
\`\`\`typescript
const client = new Client({...});

// Step 1: List users (verified via getOperation)
const users = await client.request('GET /users', {});

// Step 2: Get products for each user (verified via getOperation)
const productsPerUser = await Promise.all(
    users.map(user => client.request('GET /users/{userId}/products', {
        // Ensure 'userId' matches the parameter name from getOperation result
        { userId: user.id }
    }))
);
\`\`\`"

## Example 3: Request Not Requiring Verification (Initially)

**User:** What operations are related to 'billing'?

**Assistant Thought Process (Simulated):**
1. Intent: User wants a list of operations related to billing.
2. Relevant Operations: Search the provided list for 'billing' in summary/description/path.
3. Verification Check: NO - user is asking for a list/summary, not specific code or details requiring \`getOperation\` yet.
4. Mandatory Tool Call: Not required at this stage.

**Assistant Response:**
"Based on the available operations list, here are some operations related to 'billing':
- \`operation_getBillingInfo\`: summary...
- \`operation_updateBillingDetails\`: summary...
If you'd like code examples or more details on how to use a specific one, let me know, and I will use \`getOperation\` to get the verified details first."


# Context

## API Client Construction
Use the following pattern to construct the client:
\`\`\`typescript
${generator.client()}
\`\`\`

## Available Operations
Here is a list of available operations you can use. Remember to use \`getOperation\` for specifics before generating code.
\`\`\`
${availableOperations}
\`\`\`

# Final Instruction

Now, address the user's request. First, think carefully step-by-step following the 'Reasoning Steps (Workflow)' outlined above to ensure accuracy and proper tool usage. Then, proceed with the required actions (calling tools or formulating the response).
`,
      parallel_tool_calls: false,
      tool_choice: 'required',
    });
    this.#inputTokenCounter += response.usage?.input_tokens || 0;
    this.#outputTokenCounter += response.usage?.output_tokens || 0;

    console.log(
      `Input tokens: ${response.usage?.input_tokens}, Output tokens: ${response.usage?.output_tokens}`,
    );

    return this.#think(response);
  }
}
const prompt = await readFile(
  '/Users/ezzabuzaid/Desktop/January/sdk-it/apps/api/src/assets/prompt.txt',
  'utf-8',
);
// You are an AI assistant helping users understand and interact with an API defined by an OpenAPI specification.
// Use the available tools to find operations, generate code snippets, and look up model definitions based on the user's questions.
// If you are unsure, the user's request is ambiguous, or you need clarification beyond the API spec, use the 'requestHumanAssistance' tool.
// When finding operations, provide the operationId, method, path, and summary.
// When generating snippets, confirm the operation first if ambiguous.
// When getting model definitions, provide the full schema.
const convo = new Convo([
  // tool({
  //   name: 'apiNotSupported',
  //   description: 'Tell the user that the API is not supported',
  //   parameters: z.object({
  //     reason: z.string().describe('The reason why the API is not supported'),
  //   }),
  //   execute: async (args) => {
  //     console.log('API is not supported:', args.reason);
  //     process.exit(0);
  //   },
  // }),
  tool({
    name: 'think',
    description:
      'Use the tool to think about something. It will not obtain new information or make any changes to the repository, but just log the thought. Use it when complex reasoning or brainstorming is needed. For example, if you explore the repo and discover the source of a bug, call this tool to brainstorm several unique ways of fixing the bug, and assess which change(s) are likely to be simplest and most effective. Alternatively, if you receive some test results, call this tool to brainstorm ways to fix the failing tests.',
    parameters: z.object({
      thought: z.string().describe('Your thoughts.'),
    }),
    execute: async (args) => {
      console.log('\n🤔 THINKING:', args.thought);
      return "I've processed this thought. Continue with your reasoning or proceed to action.";
    },
  }),
  tool({
    name: 'craftPlan',
    description:
      'Use this tool to create a plan if the user inquery/question is not sufficient. It will not obtain new information or make any changes to the repository, but just log the plan. Use it when you need to outline your next steps or actions.',
    parameters: z.object({
      plan: z.string().describe('Your plan.'),
    }),
    execute: async (args) => {
      console.log('\n📝 CRAFTING PLAN:', args.plan);
      return "I've noted this plan. Proceed with your reasoning or actions.";
    },
  }),
  tool({
    name: 'requestHumanAssistance',
    description:
      "Use this tool when you cannot answer the user's question using the OpenAPI spec or other tools, or if the query is not supported, ambiguous or needs clarification.",
    parameters: z.object({
      whatShouldUserDo: z
        .string()
        .describe('The actionable response to the user, if applicable.'),
    }),
    execute: async (args) => {
      console.log('Requesting human assistance:', args.whatShouldUserDo);
      process.exit(0);
      // return (
      //   'Requesting human assistance for the following reason: ' +
      //   `${args.reason}. User query: ${args.userQuery}`
      // );
    },
  }),
  tool({
    name: 'getOperation',
    description: 'Find an operation in the OpenAPI spec.',
    parameters: z.object({
      operationId: z.string().describe('The operation ID to find.'),
    }),
    execute: async (args) => {
      console.log('Finding operation with ID:', args.operationId);
      const result = findOperationById(args.operationId);
      if (typeof result === 'string') {
        return result;
      }
      return JSON.stringify({
        operationId: result.operation.operationId,
        method: result.entry.method,
        parameters: result.operation.parameters,
        path: result.entry.path,
        requestBody: result.operation.requestBody,
        description: result.operation.description,
        summary: result.operation.summary,
      });
    },
  }),
  tool({
    name: 'generateSnippet',
    description:
      'Generate a code snippet in TypeScript for the specified operation ID. ',
    parameters: z.object({
      operationId: z
        .string()
        .describe('The operation ID to generate a snippet for.'),
      requestBody: z.string().meta({
        description:
          'JSON stringifed opereation body to be passed in the request. only if needed.',
      }),
      queryParameters: z.string().meta({
        description:
          'JSON stringifed object of query parameters to be passed in the request. only if needed.',
      }),
      pathParameters: z.string().meta({
        description:
          'JSON stringifed object of path parameters to be passed in the request. only if needed.',
      }),
      headers: z.string().meta({
        description:
          'JSON stringifed object of headers to be passed in the request. only if needed.',
      }),
      cookies: z.string().meta({
        description:
          'JSON stringifed object of cookies to be passed in the request. only if needed.',
      }),
    }),
    execute: async (args) => {
      // FIXME: generate the snippet with providede values
      // otherwise the model keep repeating the same tool call
      console.log(
        'Generating snippet for operation with ID:',
        args.operationId,
        args.requestBody,
        args.queryParameters,
        args.pathParameters,
      );
      const operation = findOperationById(args.operationId);
      if (typeof operation === 'string') {
        return operation;
      }
      return generator.succinct(operation.entry, operation.operation);
    },
  }),
  tool({
    name: 'getSchemaDefinition',
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
]);

function findOperationById(operationId: string) {
  const name = operationId.split('operation_')[1];
  if (!name) {
    return `Invalid operation ID format. Expected format: operation_<operationId>. Received: ${operationId}`;
  }
  for (const [entry, operation] of operations) {
    if (operation.operationId === name) {
      return { entry, operation };
    }
  }
  return 'Could not find operation with ID: ' + operationId;
}

// const response = await convo.talk(
//   'I want to create simple chatbot with history preserved using chat completion api',
// );
// const response = await convo.talk(
//   'how to list all assistants and their associated vectore stores',
// );
// const response = await convo.talk(
//   'I want to create simple chatbot with history preserved using responses api',
// );
marked.use((markedTerminal as any)());
// const response = await convo.talk('how to use monitor?');
// console.dir(response.output, { depth: 10 });

// console.log(marked.parse(response.output_text));

let previousResponseId: string | null | undefined = null;
// let currentPrompt = 'how to use monitor?';
let currentPrompt = '';

console.log(
  '----- Type your question or "exit" to quit -----\n',
  'You can ask about the API operations, generate code snippets, or look up schema definitions.\n',
  'For example:\n',
  '- How do I create a user?\n',
  '- How to list user products?\n',
  '- How to get products for each user?\n',
  '- How to use monitor?\n',
);
while (true) {
  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'question',
      message: '> ',
    },
  ]);

  currentPrompt = answers.question;
  const response = await convo.talk(currentPrompt, previousResponseId);
  // console.dir(response.output, { depth: 10 });
  console.log(marked.parse(response.output_text));
  previousResponseId = response.id;
  console.log('\n----- Type your next question or "exit" to quit -----');

  // Check if user wants to exit
  if (
    currentPrompt.toLowerCase() === 'exit' ||
    currentPrompt.toLowerCase() === 'quit'
  ) {
    console.log('Exiting conversation...');
    break;
  }
}
