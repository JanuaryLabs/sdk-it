# Build a Figma SDK

## Generate the SDK

Inside an existing TypeScript project:

```bash
npm install zod fast-content-type-parse

npx @sdk-it/cli@latest generate typescript \
  --spec https://raw.githubusercontent.com/figma/rest-api-spec/refs/heads/main/openapi/openapi.yaml \
  --output ./src/generated/figma \
  --name Figma \
  --mode minimal
```

## Create the client

```typescript
import { Figma } from './src/generated/figma/index.ts';

const figma = new Figma({
  'X-Figma-Token': process.env.FIGMA_ACCESS_TOKEN,
});
```

The generated endpoints include the `/v1` path prefix and use the
specification's default `https://api.figma.com` server.

## Get file information

```typescript
const file = await figma.request('GET /v1/files/{file_key}', {
  file_key: 'your-file-key',
});

console.log(`File name: ${file.name}`);
console.log(`Last modified: ${file.lastModified}`);
console.log(`Version: ${file.version}`);
console.log(`Document: ${file.document.name}`);
```

## Get file comments

```typescript
const result = await figma.request('GET /v1/files/{file_key}/comments', {
  file_key: 'your-file-key',
});

console.log(`Total comments: ${result.comments.length}`);
for (const comment of result.comments) {
  console.log(`- ${comment.user.handle}: ${comment.message}`);
}
```

## Get component sets

```typescript
const result = await figma.request('GET /v1/files/{file_key}/component_sets', {
  file_key: 'your-file-key',
});

for (const componentSet of result.meta.component_sets) {
  console.log(`Component set: ${componentSet.name} (${componentSet.key})`);
  console.log(`- Description: ${componentSet.description}`);
}
```

## Get style references

```typescript
const result = await figma.request('GET /v1/files/{file_key}/styles', {
  file_key: 'your-file-key',
});

for (const style of result.meta.styles) {
  console.log(`Style: ${style.name} (${style.key})`);
  console.log(`- Type: ${style.style_type}`);
  console.log(`- Description: ${style.description || 'No description'}`);
}
```

## Post a comment

```typescript
const comment = await figma.request('POST /v1/files/{file_key}/comments', {
  file_key: 'your-file-key',
  message: 'This is a new comment added through the API',
  client_meta: {
    x: 100,
    y: 200,
  },
});

console.log(`Comment posted: ${comment.id}`);
```
