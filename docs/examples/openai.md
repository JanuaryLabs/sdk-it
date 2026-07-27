# Build an OpenAI SDK

## Generate the SDK

Inside an existing TypeScript project:

```bash
npm install zod fast-content-type-parse

npx @sdk-it/cli@latest generate typescript \
  --spec https://raw.githubusercontent.com/openai/openai-openapi/refs/heads/main/openapi.yaml \
  --output ./src/generated/openai \
  --name OpenAI \
  --mode minimal
```

## Create the client

```typescript
import { APIError, OpenAI, ParseError } from './src/generated/openai/index.ts';

const openai = new OpenAI({
  token: process.env.OPENAI_API_KEY,
});
```

## Create a response

```typescript
try {
  const result = await openai.request('POST /responses', {
    model: 'gpt-5.4-mini',
    instructions: 'You are an expert business developer.',
    input: 'How is the market for SDK generation products?',
  });

  console.log(result.output_text);
} catch (error) {
  if (error instanceof ParseError) {
    console.error('Invalid request input:', error.data);
  } else if (error instanceof APIError) {
    console.error(`OpenAI returned ${error.status}:`, error.data);
  } else {
    throw error;
  }
}
```

## Create an embedding

```typescript
const result = await openai.request('POST /embeddings', {
  model: 'text-embedding-3-small',
  input: 'The quick brown fox jumps over the lazy dog',
});

console.log(result.data[0].embedding);
```

## List available models

```typescript
const result = await openai.request('GET /models', {});

for (const model of result.data) {
  console.log(`${model.id}: ${model.owned_by}`);
}
```
