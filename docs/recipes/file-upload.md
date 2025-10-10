## Handling File Uploads with SDK-IT, Hono, and React Query

This article demonstrates implementing type-safe `multipart/form-data` file uploads using SDK-IT with Hono on the backend and React Query on the frontend.

We use the `@sdk-it/hono/runtime` `validate` middleware for backend validation and the generated SDK with the `useAction` hook (from the React Query integration recipe) for the frontend.

### Backend: Hono Route with Validation

- Define a Hono route accepting `multipart/form-data`.
- Use the `validate` middleware from `@sdk-it/hono/runtime`, specifying `'multipart/form-data'` as the content type and `z.instanceof(File)` for file validation.
- The `@openapi` tag enables SDK generation.

```typescript
// upload.ts
import { Hono } from 'hono';
import { z } from 'zod';

import { validate } from '@sdk-it/hono/runtime';

const app = new Hono();

/**
 * @openapi uploadFile
 * @summary Uploads a single file.
 * @tags uploads
 */
app.post(
  '/upload',
  validate('multipart/form-data', (payload) => ({
    // Validate the 'file' field in the form data
    file: {
      select: payload.body.file,
      against: z.instanceof(File), // Ensure it's a File object
    },
    // Validate other non-file form fields if needed
    description: {
      select: payload.body.description,
      against: z.string().optional(),
    },
  })),
  async (c) => {
    // Access validated input, including the File object
    const { file, description } = c.var.input;

    console.log(`Received file: ${file.name} (${file.size} bytes)`);
    if (description) {
      console.log(`Description: ${description}`);
    }

    // --- Add file processing logic here (e.g., save to storage) ---
    // const fileBuffer = Buffer.from(await file.arrayBuffer());
    // await writeFile(join(process.cwd(), 'uploads', crypto.randomUUID()), fileBuffer);
    // ---

    return c.json({
      message: `File '${file.name}' uploaded successfully.`,
      fileName: file.name,
      size: file.size,
      type: file.type,
    });
  },
);

export default app;
```

### SDK Generation

> [!NOTE]
> This step analyzes your backend code (specifically the route using `validate` and `@openapi`) to generate the type-safe client SDK used by the frontend.

<details>
<summary>View SDK Generation Script and Execution</summary>

Create a script to analyze the backend code and generate the TypeScript client SDK.

**`sdk.ts` (example script):**

```typescript
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { analyze } from '@sdk-it/generic';
import { responseAnalyzer } from '@sdk-it/hono';
import { generate } from '@sdk-it/typescript';

console.log('Analyzing backend code...');

// Point to your backend's tsconfig.json
const { paths, components } = await analyze('./tsconfig.json', {
  responseAnalyzer,
});

const spec = {
  openapi: '3.1.0',
  info: {
    title: 'My API',
    version: '1.0.0',
  },
  paths,
  components,
};

// Optional: Save the intermediate OpenAPI spec
// await writeFile('openapi.json', JSON.stringify(spec, null, 2));

console.log('Generating TypeScript SDK...');
// Generate the client SDK into the frontend source
await generate(spec, {
  output: join(process.cwd(), './client'),
  name: 'Client', // Optional client class name
});

console.log('SDK generated successfully!');
```

**Run the generation script:**

```bash
# Using tsx
npx tsx ./generate-sdk.ts

# Using Node.js >= 22
# node ./generate-sdk.ts

# Using Bun
# bun ./generate-sdk.ts
```

This process generates a type-safe function for the `/upload` endpoint in your frontend SDK directory (`./path/to/your/frontend/src/sdk` in this example).

**Further Reading:**

- **Code Analysis:** [`@sdk-it/generic`](../../packages/generic/README.md)
- **Hono Integration:** [`@sdk-it/hono`](../../packages/hono/README.md)
- **TypeScript SDK Output:** [`@sdk-it/typescript`](../../packages/typescript/README.md)

</details>

### Frontend: React Component with `useAction`

Use the generated SDK in a React component via the `useAction` hook (from the `api.tsx` recipe). Pass an object to `mutateAsync` where keys match the backend's expected form field names (`file`, `description`). The underlying `fetch` handles `FormData` creation when a `File` object is detected.

```tsx
// src/components/FileUpload.tsx
import React from 'react';

import { useAction } from '../use-client.tsx';

function FileUpload() {
  const uploadMutation = useAction('POST /upload', {
    onSuccess: (data) => {
      console.log('Upload successful:', data);
      alert(`Successfully uploaded ${data.fileName}`);
    },
    onError: (error) => {
      console.error('Upload failed:', error);
      alert(`Upload failed: ${error.message || 'Unknown error'}`);
    },
  });

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileInput = e.target;
    const file = fileInput.files?.[0];

    if (!file) return;

    // Trigger mutation, passing the File object directly.
    // Keys 'file' and 'description' match the backend validator.
    await uploadMutation.mutateAsync({
      file: file,
      description: `Uploaded via React on ${new Date().toLocaleDateString()}`,
    });
    // Reset input for subsequent uploads
    fileInput.value = '';
  };

  return (
    <div>
      <label htmlFor="file-upload">Choose file to upload:</label>
      <input
        id="file-upload"
        type="file"
        onChange={handleFileChange}
        disabled={uploadMutation.isPending} // Disable while uploading
      />
      {uploadMutation.isPending && <p>Uploading...</p>}
      {uploadMutation.isError && (
        <p style={{ color: 'red' }}>
          Error: {uploadMutation.error?.message || 'Upload failed'}
        </p>
      )}
    </div>
  );
}

export default FileUpload;
```

### Notes

- The combination of `validate('multipart/form-data', ...)` and `z.instanceof(File)` on the backend is key for correct validation and SDK generation.
- The `@openapi` tag on the Hono route is essential for the analyzer to discover the endpoint.
- The `useAction` hook ([as defined in the React Query helper](../react-query.md)) automatically handles creating the `FormData` object when it detects a `File` instance in the in the mutation payload. You don't need to manually create `FormData`.
- Type safety is preserved throughout the process, from backend validation to frontend usage.
