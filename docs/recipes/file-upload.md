# File uploads with SDK-IT, Hono, and React Query

Type-safe `multipart/form-data` file uploads with Hono (backend) and React Query
(frontend).

The backend validates with `@sdk-it/hono/runtime`'s `validate` middleware. The
frontend uses the generated SDK through the `useAction` hook
([React Query recipe](../react-query.md)).

## Backend: Hono route with validation

- Define a Hono route accepting `multipart/form-data`.
- Use the `validate` middleware from `@sdk-it/hono/runtime`, specifying `'multipart/form-data'` as the content type and `z.instanceof(File)` for file validation.
- The optional `@openapi` tag gives the operation an explicit ID.

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
  (c) => {
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

## SDK generation

> [!NOTE]
> This step analyzes your backend code, including routes using `validate`, to
> generate the type-safe client SDK used by the frontend.

<details>
<summary>View SDK Generation Script and Execution</summary>

Create a script to analyze the backend code and generate the TypeScript client SDK.

**`sdk.ts` (example script):**

```typescript
import { resolve } from 'node:path';

import { analyze } from '@sdk-it/generic';
import { responseAnalyzer } from '@sdk-it/hono';
import { generate } from '@sdk-it/typescript';

console.log('Analyzing backend code...');

// Point to your backend's tsconfig.json
const { paths, components } = await analyze('./tsconfig.json', {
  responseAnalyzer,
});

const spec = {
  openapi: '3.1.0' as const,
  info: {
    title: 'My API',
    version: '1.0.0',
  },
  paths,
  components,
};

console.log('Generating TypeScript SDK...');
await generate(spec, {
  output: resolve('client'),
  name: 'Client',
});

console.log('SDK generated successfully!');
```

**Run the generation script:**

```bash
node ./sdk.ts
```

This process generates a typed `POST /upload` endpoint in `./client`.

**Further Reading:**

- **Code Analysis:** [`@sdk-it/generic`](../../packages/generic/README.md)
- **Hono Integration:** [`@sdk-it/hono`](../../packages/hono/README.md)
- **TypeScript SDK Output:** [`@sdk-it/typescript`](../../packages/typescript/README.md)

</details>

## Frontend: React component with `useAction`

Use the generated SDK in a React component via the `useAction` hook from the
[React Query recipe](../react-query.md). Pass an object whose keys match the
backend's form fields (`file`, `description`). Because the endpoint consumes
`multipart/form-data`, the generated request serializer builds `FormData`
without setting the `Content-Type` header itself.

```tsx
// src/components/FileUpload.tsx
import type { ChangeEvent } from 'react';

import { useAction } from '../use-client.ts';

function FileUpload() {
  const uploadMutation = useAction('POST /upload', {
    onSuccess: (data) => {
      console.log('Upload successful:', data);
      alert(`Successfully uploaded ${data.fileName}`);
    },
    onError: (error) => {
      console.error('Upload failed:', error);
      alert('Upload failed');
    },
  });

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const fileInput = event.currentTarget;
    const file = fileInput.files?.[0];

    if (!file) return;

    uploadMutation.mutate({
      file,
      description: `Uploaded via React on ${new Date().toLocaleDateString()}`,
    });
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
      {uploadMutation.isError && <p role="alert">Upload failed.</p>}
    </div>
  );
}

export default FileUpload;
```

## Notes

- The combination of `validate('multipart/form-data', ...)` and
  `z.instanceof(File)` on the backend is key for correct validation and SDK
  generation.
- The optional `@openapi` tag gives the operation an explicit ID. Routes using
  `validate` are discovered without it.
- The generated endpoint selects its `FormData` serializer from the declared
  `multipart/form-data` request content type; it does not inspect values to
  detect a `File`.
- Types stay safe from backend validation through frontend usage.

## Binary fields in generated SDKs

Backend routes use `z.instanceof(File)` because Node has `File` as a global.
Generated client SDKs cannot assume the same—they ship to browsers, workers,
and older Node versions where `Blob`, `File`, `Request`, or `Response` may not
exist as globals.

To stay portable, the generator emits `z.custom<Blob>()` (and similar) for
binary fields instead of `z.instanceof(Blob)`. The static type stays `Blob`;
only the runtime `instanceof` check is dropped, since referencing `Blob` as a
value would throw `ReferenceError` in environments without it.

Trade-off: the SDK does not reject a non-Blob value at the validation step, and
`FormData` may coerce it instead. If strict client-side runtime validation is
required, validate before calling the SDK. Keep `z.instanceof(File)` on the
server trust boundary; this portability choice only affects emitted client
code.
