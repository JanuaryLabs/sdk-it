## Build Figma SDK

### Generate SDK

```bash
npx @sdk-it/cli@latest \
  --spec https://raw.githubusercontent.com/figma/rest-api-spec/refs/heads/main/openapi/openapi.yaml \
  --output ./figma \
  --name Figma \
  --mode full
```

### Create and configure Client

```ts
import { Figma } from './figma';

const client = new Figma({
  baseUrl: 'https://api.figma.com/v1',
  token: process.env.FIGMA_ACCESS_TOKEN,
});
```

### Get File Information

```ts
const [result, error] = await client.request('GET /files/{file_key}', {
  file_key: 'your-file-key',
});

if (!error) {
  console.log(`File name: ${result.name}`);
  console.log(`Last modified: ${result.lastModified}`);
  console.log(`Version: ${result.version}`);
  console.log(`Document: ${result.document.name}`);
} else {
  console.error(error);
}
```

### Get File Comments

```ts
const [result, error] = await client.request('GET /files/{file_key}/comments', {
  file_key: 'your-file-key',
});

if (!error) {
  console.log(`Total comments: ${result.comments.length}`);
  for (const comment of result.comments) {
    console.log(`- ${comment.user.handle}: ${comment.message}`);
  }
} else {
  console.error(error);
}
```

### Get Component Sets

```ts
const [result, error] = await client.request(
  'GET /files/{file_key}/component_sets',
  {
    file_key: 'your-file-key',
  },
);

if (!error) {
  for (const [id, componentSet] of Object.entries(result.meta.component_sets)) {
    console.log(`Component set: ${componentSet.name} (${id})`);
    console.log(`- Description: ${componentSet.description}`);
    console.log(`- Contains ${componentSet.components.length} components`);
  }
} else {
  console.error(error);
}
```

### Get Style References

```ts
const [result, error] = await client.request('GET /files/{file_key}/styles', {
  file_key: 'your-file-key',
});

if (!error) {
  for (const style of Object.values(result.meta.styles)) {
    console.log(`Style: ${style.name} (${style.key})`);
    console.log(`- Type: ${style.style_type}`);
    console.log(`- Description: ${style.description || 'No description'}`);
  }
} else {
  console.error(error);
}
```

### Post a Comment

```ts
const [result, error] = await client.request(
  'POST /files/{file_key}/comments',
  {
    file_key: 'your-file-key',
    message: 'This is a new comment added via the API',
    client_meta: {
      x: 100,
      y: 200,
    },
  },
);

if (!error) {
  console.log(`Comment posted successfully! Comment ID: ${result.id}`);
} else {
  console.error(error);
}
```
