/* eslint-disable @typescript-eslint/no-explicit-any */
import { OpenAI } from 'openai';
import type { ChatCompletionTool } from 'openai/resources/index.mjs';
import type {
  FunctionTool,
  ResponseInput,
} from 'openai/resources/responses/responses.mjs';
import { z } from 'zod';

import { TypeScriptGenerator } from '@sdk-it/typescript';

import openai from '../apps/api/src/openai';

export type ToolExecutor<T> = (args: T) => Promise<unknown>;
export type ToolDefinition<T> = FunctionTool & { execute: ToolExecutor<T> };

export function tool<T>(spec: {
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

tool.legacy = <T>(spec: {
  name: string;
  description: string;
  parameters: z.ZodType<T>;
  execute: ToolExecutor<T>;
}): ChatCompletionTool & { execute: ToolExecutor<T> } => {
  return {
    type: 'function',
    execute: spec.execute,
    function: {
      name: spec.name,
      description: spec.description,
      parameters: z.toJSONSchema(spec.parameters, { reused: 'inline' }),
      strict: true,
    },
  };
};

export class Convo {
  #counter = 0;
  #tools: ToolDefinition<any>[] = [];

  #inputTokenCounter = 0;
  #outputTokenCounter = 0;
  #availableOperations = '';
  #generator: TypeScriptGenerator;

  constructor(
    generator: TypeScriptGenerator,
    availableOperations: string,
    tools: ToolDefinition<any>[],
  ) {
    this.#tools = tools ?? [];
    this.#generator = generator;
    this.#availableOperations = availableOperations;
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
    console.log('   - Sending response back to OpenAI...');

    return this.talk(input, response.id);
  }

  async talk(
    message: ResponseInput,
    previous_response_id?: string | null,
  ): Promise<OpenAI.Responses.Response> {
    this.#counter++;
    if (this.#counter === 1) {
      message.push({
        role: 'assistant',
        content: `I'll start by using the "craftPlan" tool to create a plan for the task or with "think" tool to contemplate the user inquery.`,
      });
      message.push({
        role: 'assistant',
        content: `I should generate code snippets and explanations based on the OpenAPI spec and the TypeScript SDK. To get more info about the operations, I will use the "getOperations" tool and "getSchemaDefinition" tool.`,
      });
    }
    const response = await openai.responses.create({
      model: 'o4-mini',
      input: message,
      tools: [
        // {
        //   type: 'file_search',
        //   vector_store_ids: [VECTOR_STORE_ID],
        //   filters: { key: 'name', type: 'eq', value: this.#spec.info.title },
        // },
        ...this.#tools,
      ],
      stream: false,
      top_p: 0.25,
      temperature: 0,
      previous_response_id,
      store: true,
      instructions: `
# Role and Objective

You are a specialized AI assistant designed to help users understand and interact with an API defined by an OpenAPI specification, using a generated TypeScript SDK. Your primary objective is to provide accurate information and functional code snippets based **strictly** on the provided API specification and tool outputs. Accuracy and adherence to the specified workflow are paramount.

# Instructions

## General Guidance
- Prioritize accuracy above all else. Rely *only* on the provided API specification details retrieved via tools.
- Maintain a professional and helpful tone.

## Tool Usage (CRITICAL)
- **Mandatory Verification:** You **MUST** use the \`getOperations\` tool to retrieve the exact details (parameters, request body, etc.) of an API operation **BEFORE** you generate a code snippet for it OR explain its specific details.
- **No Guessing:** If you are unsure about any detail regarding an API operation (its parameters, structure, or exact purpose), use the \`getOperations\` tool to get the facts. **DO NOT GUESS OR MAKE UP ANSWERS.**
- **Planning Before Tools:** Before calling any tool, briefly outline your plan or the reason for the tool call (you will be prompted to think step-by-step below).
- **Reflection After Tools:** After receiving output from a tool (especially \`getOperations\`), incorporate that information accurately into your next step or response.
- **Tool Failure/Ambiguity:** If \`getOperations\` fails or returns an error, or if the user's request is too ambiguous to confidently select an operation ID, use the \`requestHumanAssistance\` tool and explain the issue. Do not proceed with generating potentially incorrect information.

## Prohibited Actions
- Do not generate code snippets or explain operation specifics based on assumptions, memory, or the initial list of available operations. Your knowledge is incomplete until \`getOperations\` provides details.
- Do not answer questions outside the scope of the provided API specification.

# Reasoning Steps (Workflow)

Follow these steps precisely for every user request:

1.  **Planing**: **For any request requiring code generation or specific operation details, your first action must be to generate a step-by-step plan using "craftPlan" tool.**
1.  **Query Analysis:** Break down the user's request to understand the core intent. Identify what API operation(s) might be relevant.
2.  **Verification Check:** Determine if fulfilling the request requires generating a code snippet for a specific operation OR explaining its detailed parameters, request body, or response structure.
3.  **Mandatory Tool Call (If Verification Check is YES):**
    a. Announce your plan to call \`getOperations\` for the specific operation ID.
    b. **Call the \`getOperations\` tool.**
    c. Wait for the tool's output. Analyze the retrieved operation details.
    d. If the tool call fails or details are unexpected, reconsider your plan or use \`requestHumanAssistance\`.
4.  **Response Generation:**
    a. If step 3 was performed, explicitly state that you are using the verified information from \`getOperations\`.
    b. Generate the final response, code snippet (using verified details), or explanation according to the Output Format guidelines.
    c. If step 3 was not required (e.g., a general question), generate the response based on available information (like the operation list for summaries).

# Output Format

- Respond clearly and structurly.
- **Confirmation:** When providing a code snippet or detailed explanation based on \`getOperations\`'s output, **always** start by confirming you used the tool, e.g., "Okay, I have fetched the details for \`operation_xyz\` using \`getOperations\`. Based on the verified information:".
- **Code Snippets:**
    - Provide code snippets in TypeScript using the SDK.
    - Ensure snippets accurately reflect the operation's structure (path, method, parameters, body) as confirmed by \`getOperations\`.
    - Use the client construction pattern provided below.
- **Clarity:** If suggesting alternative operations, explain why the direct match wasn't found or suitable.

# Examples

## Example 1: Direct Request Requiring Verification

**User:** How do I create a user?

**Assistant Thought Process (Simulated):**
1. Intent: User wants to create a user.
2. Relevant Operation: Likely involves a POST to a user endpoint. Need to find the exact operationId. Assume it's \`operation_createUser\`.
3. Verification Check: YES - user needs a code snippet.
4. Mandatory Tool Call: Need to call \`getOperations\` for \`operation_createUser\`.

**Assistant Action:**
*Calls: \`getOperations({ operationId: 'operation_createUser' })\`*
*(Waits for tool result containing method: POST, path: /users, requestBody schema, etc.)*

**Assistant Response:**
"Okay, I have fetched the details for \`operation_createUser\` using \`getOperations\`. Based on the verified information (POST /users), here is how you can create a user:
\`\`\`typescript
const client = new Client({...});
// Assuming the request body requires 'name' based on getOperations result
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
5. Mandatory Tool Calls: Must call \`getOperations\` for \`operation_listUsers\` AND \`getOperations\` for \`operation_listUserProducts\` before generating final code.

**Assistant Action:**
*Calls: \`getOperations({ operationId: 'operation_listUsers' })\`*
*(Gets result: GET /users)*
*Calls: \`getOperations({ operationId: 'operation_listUserProducts' })\`*
*(Gets result: GET /users/{userId}/products, requires path param \`userId\`)*

**Assistant Response:**
"Okay, to get products for each user, we need two steps. I've fetched the details using \`getOperations\` for both \`operation_listUsers\` (GET /users) and \`operation_listUserProducts\` (GET /users/{userId}/products). Based on this verified information:
1. First, list all users.
2. Then, loop through the users and get products for each user ID.

Here's the code:
\`\`\`typescript
const client = new Client({...});

// Step 1: List users (verified via getOperations)
const users = await client.request('GET /users', {});

// Step 2: Get products for each user (verified via getOperations)
const productsPerUser = await Promise.all(
    users.map(user => client.request('GET /users/{userId}/products', {
        // Ensure 'userId' matches the parameter name from getOperations result
        { userId: user.id }
    }))
);
\`\`\`"

## Example 3: Request Not Requiring Verification (Initially)

**User:** What operations are related to 'billing'?

**Assistant Thought Process (Simulated):**
1. Intent: User wants a list of operations related to billing.
2. Relevant Operations: Search the provided list for 'billing' in summary/description/path.
3. Verification Check: NO - user is asking for a list/summary, not specific code or details requiring \`getOperations\` yet.
4. Mandatory Tool Call: Not required at this stage.

**Assistant Response:**
"Based on the available operations list, here are some operations related to 'billing':
- \`operation_getBillingInfo\`: summary...
- \`operation_updateBillingDetails\`: summary...
If you'd like code examples or more details on how to use a specific one, let me know, and I will use \`getOperations\` to get the verified details first."


# Context

## API Client Construction
Use the following pattern to construct the client:
\`\`\`typescript
${this.#generator.client()}
\`\`\`

## Available Operations
Here is a list of available operations you can use. Remember to use \`getOperations\` for specifics before generating code.
\`\`\`
${this.#availableOperations}
\`\`\`

# Final Instruction

Now, address the user's request. First, think carefully step-by-step following the 'Reasoning Steps (Workflow)' outlined above to ensure accuracy and proper tool usage. Then, proceed with the required actions (calling tools or formulating the response).
`,
      parallel_tool_calls: true,
      tool_choice: 'required',
    });
    this.#inputTokenCounter += response.usage?.input_tokens || 0;
    this.#outputTokenCounter += response.usage?.output_tokens || 0;

    console.log(
      `Input tokens: ${this.#inputTokenCounter}, Output tokens: ${this.#outputTokenCounter}`,
    );

    return this.#think(response);
  }
}
