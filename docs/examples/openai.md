## Build OpenAI SDK

### Generate SDK

```bash
npx @sdk-it/cli@latest typescript \
  --spec https://raw.githubusercontent.com/openai/openai-openapi/refs/heads/master/openapi.yaml \
  --output ./openai \
  --name OpenAI \
  --mode full
```

### Create and configure Client

```ts
import { OpenAI } from './openai';

const openai = new Client({
  baseUrl: 'https://api.openai.com/v1',
  token: process.env.OPENAI_API_KEY,
});
```

### Create ai response with web search tool

```ts
const [result, error] = await openai.request('POST /responses', {
  model: 'gpt-4o',
  instructions: `You are an expert business developer`,
  input: 'How is the market for sdk generation products?',
  tool_choice: 'required',
  parallel_tool_calls: true,
  tools: [
    {
      type: 'web_search_preview',
      user_location: {
        type: 'approximate',
      },
      search_context_size: 'high',
    },
  ],
});

if (!error) {
  console.log(
    result.output
      .filter((it) => it.type === 'message')
      .flatMap((it) =>
        it.content.filter((c) => c?.type === 'output_text').map((c) => c.text),
      ),
  );
} else {
  if (error.kind === 'parse') {
    console.log('Parse Error'); // you sent invalid or non-compliant data
    console.error(error);
  } else {
    console.log('HTTP Error');
    console.error(error);
  }
}
```

### Create a Chat Completion

```ts
const [result, error] = await openai.request('POST /chat/completions', {
  model: 'gpt-4',
  messages: [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'Hello, who are you?' },
  ],
});

if (!error) {
  console.log(result.choices[0].message.content);
} else {
  console.error(error);
}
```

### Create an Embedding

```ts
const [result, error] = await openai.request('POST /embeddings', {
  model: 'text-embedding-ada-002',
  input: 'The quick brown fox jumps over the lazy dog',
});

if (!error) {
  console.log(result.data[0].embedding);
} else {
  console.error(error);
}
```

### List Available Models

```ts
const [result, error] = await openai.request('GET /models', {});

if (!error) {
  for (const model of result.data) {
    console.log(`${model.id}: ${model.owned_by}`);
  }
} else {
  console.error(error);
}
```
