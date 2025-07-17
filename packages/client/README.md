# SDK-IT API TypeScript SDK

A fully-typed TypeScript SDK with comprehensive IntelliSense support, automatic request/response validation, and modern async/await patterns. Built for seamless integration with TypeScript and JavaScript projects.

## Installation

```bash
npm install @sdkit/sdk
```

## Basic Usage

```typescript
import { SdkIt } from '@sdkit/sdk';

const sdkIt = new SdkIt({
  baseUrl: '/',
  token: '"<token>"',
});
```

### Configuration Options

| Option    | Type               | Required | Description                                   |
| --------- | ------------------ | -------- | --------------------------------------------- |
| `fetch`   | `fetch compatible` | No       | Fetch implementation to use for HTTP requests |
| `baseUrl` | `string`           | No       | API base URL (default: `/`)                   |
| `token`   | `string`           | No       | Bearer token for authentication               |

### Updating Configuration

You can update client configuration after initialization using the `setOptions` method:

```typescript
// Initial client setup
const sdkIt = new SdkIt({
  baseUrl: 'https://api.production-service.com',
  token: 'prod_sk_1234567890abcdef',
});

// Later, update specific options
client.setOptions({
  baseUrl: 'https://api.staging-service.com',
  token: 'staging_sk_abcdef1234567890',
});
```

The `setOptions` method validates the provided options and only updates the specified fields, leaving other configuration unchanged.

## Authentication

The SDK requires authentication to access the API. Configure your client with the required credentials:

### Bearer Token

Pass your bearer token directly - the "Bearer" prefix is automatically added:

```typescript
const sdkIt = new SdkIt({
  token: 'REDACTED_STRIPE_KEY',
});
```

## Pagination

This SDK automatically handles pagination for endpoints that return multiple items.

### How it Works

When you call a paginated endpoint, the SDK returns a pagination object that allows you to iterate through all results:

```typescript
// The SDK automatically handles pagination
const result = await sdkIt.request('GET /products', {
  limit: 20,
});

// Access the current page data
const currentPage = result.getCurrentPage();
console.log(currentPage.data); // Array of product items

// Check if more pages exist
if (result.hasMore) {
  await result.getNextPage();
}

// Or iterate through all pages automatically
for await (const page of result) {
  console.log(page);
}
```

### Iterating Through All Pages

```typescript
// Using async iteration to process all pages
const result = await sdkIt.request('GET /products', {
  limit: 100,
});

for await (const page of result) {
  console.log(page);
}
```

### Pagination Strategy

Your API uses the following pagination strategy, automatically detected by the SDK:

#### Page Pagination

Uses page number and page size:

```typescript
const result = await sdkIt.request('GET /products', {
  page: 1,
  pageSize: 20,
});

// Iterate through all pages using page numbers
for await (const page of result) {
  console.log(page);
}
```

## Error Handling

The SDK provides structured error handling with typed HTTP error responses.

### Error Response Types

All API errors extend from `APIError` and include the HTTP status code and response data:

```typescript
import {
  BadRequest,
  InternalServerError,
  NotFound,
  ParseError,
  TooManyRequests,
  Unauthorized,
} from '@sdkit/sdk';

try {
  const usersList = await sdkIt.request('GET /users', {});
  // Handle successful response
} catch (error) {
  // Handle different error types
  if (error instanceof BadRequest) {
    console.error('Bad request:', error.data);
    console.log('Status:', error.status); // 400
  } else if (error instanceof Unauthorized) {
    console.error('Authentication failed:', error.data);
    console.log('Status:', error.status); // 401
  } else if (error instanceof NotFound) {
    console.error('Resource not found:', error.data);
    console.log('Status:', error.status); // 404
  } else if (error instanceof TooManyRequests) {
    console.error('Rate limited:', error.data);
    if (error.data.retryAfter) {
      console.log('Retry after:', error.data.retryAfter);
    }
  } else if (error instanceof InternalServerError) {
    console.error('Server error:', error.data);
    console.log('Status:', error.status); // 500
  } else if (error instanceof ParseError) {
    console.error('Input validation failed:', error.data);
  }
}
```

### Available Error Classes

#### Input Validation Errors

- `ParseError` - Request input validation failed against API schema

#### Client Errors (4xx)

- `BadRequest` (400) - Invalid request data
- `Unauthorized` (401) - Authentication required
- `PaymentRequired` (402) - Payment required
- `Forbidden` (403) - Access denied
- `NotFound` (404) - Resource not found
- `MethodNotAllowed` (405) - HTTP method not allowed
- `NotAcceptable` (406) - Content type not acceptable
- `Conflict` (409) - Resource conflict
- `Gone` (410) - Resource no longer available
- `PreconditionFailed` (412) - Precondition failed
- `PayloadTooLarge` (413) - Request payload too large
- `UnsupportedMediaType` (415) - Unsupported content type
- `UnprocessableEntity` (422) - Validation errors
- `TooManyRequests` (429) - Rate limit exceeded

#### Server Errors (5xx)

- `InternalServerError` (500) - Server error
- `NotImplemented` (501) - Not implemented
- `BadGateway` (502) - Bad gateway
- `ServiceUnavailable` (503) - Service unavailable
- `GatewayTimeout` (504) - Gateway timeout

### Validation Errors

Validation errors (422) include detailed field-level error information:

### Input Validation Errors

When request input fails validation against the API schema, a `ParseError` is thrown:

```typescript
import { ParseError } from '@sdkit/sdk';

try {
  // Invalid input that doesn't match the expected schema
  const newUser = await sdkIt.request('POST /users', {
    email: 123,
    firstName: '',
    age: -5,
  });
} catch (error) {
  if (error instanceof ParseError) {
    console.log('Input validation failed:');

    // Field-level errors
    if (error.data.fieldErrors) {
      Object.entries(error.data.fieldErrors).forEach(
        ([fieldName, validationIssues]) => {
          console.log(
            `  ${fieldName}: ${validationIssues.map((issue) => issue.message).join(', ')}`,
          );
        },
      );
    }

    // Form-level errors
    if (error.data.formErrors.length > 0) {
      console.log(
        `  Form errors: ${error.data.formErrors.map((issue) => issue.message).join(', ')}`,
      );
    }
  }
}
```

`ParseError` contains detailed validation information using Zod's flattened error format, providing specific field-level and form-level validation messages.

### Rate Limiting

Rate limit responses may include a `retryAfter` field indicating when to retry:

```typescript
import { TooManyRequests } from '@sdkit/sdk';

try {
  const apiResponse = await sdkIt.request('GET /api/data', {});
} catch (error) {
  if (error instanceof TooManyRequests) {
    const retryAfterSeconds = error.data.retryAfter;
    if (retryAfterSeconds) {
      console.log(`Rate limited. Retry after: ${retryAfterSeconds} seconds`);
      // Implement your own retry logic
      setTimeout(() => {
        // Retry the request
      }, retryAfterSeconds * 1000);
    }
  }
}
```

## API Reference

### postPublish | _POST /publish_

#### Example usage

```typescript
import { SdkIt } from '@sdkit/sdk';

const sdkIt = new SdkIt({
  baseUrl: '/',
  token: '"<token>"',
});

const result = await sdkIt.request('POST /publish', {
  specUrl: 'https://example.com',
});

console.log(result.data);
```

#### Input

Content Type: `application/json`

**Type:** [`PostPublishInput`](#postpublishinput)

#### Output

**200** - Response for 200

**Content Type:** `application/json`

**Type:** [`PostPublish`](#postpublish)

**400** - Bad Request

**Content Type:** `application/json`

**Type:** [`PostPublish400`](#postpublish400)

### postAugment | _POST /augment_

#### Example usage

```typescript
import { SdkIt } from '@sdkit/sdk';

const sdkIt = new SdkIt({
  baseUrl: '/',
  token: '"<token>"',
});

const result = await sdkIt.request('POST /augment', {
  specUrl: 'https://example.com',
});

console.log(result.data);
```

#### Input

Content Type: `application/json`

**Type:** [`PostAugmentInput`](#postaugmentinput)

#### Output

**200** - OK

**Content Type:** `application/json`

**Type:** [`PostAugment`](#postaugment)

**400** - Bad Request

**Content Type:** `application/json`

**Type:** [`PostAugment400`](#postaugment400)

### getFetch | _GET /fetch_

#### Example usage

```typescript
import { SdkIt } from '@sdkit/sdk';

const sdkIt = new SdkIt({
  baseUrl: '/',
  token: '"<token>"',
});

const result = await sdkIt.request('GET /fetch', {});

console.log(result.data);
```

#### Input

Content Type: `application/empty`

**Type:** [`GetFetchInput`](#getfetchinput)

#### Output

**200** - Response for 200

**Content Type:** `application/json`

**Type:** [`GetFetch`](#getfetch)

**400** - Bad Request

**Content Type:** `application/json`

**Type:** [`GetFetch400`](#getfetch400)

### postGenerate | _POST /generate_

#### Example usage

```typescript
import { SdkIt } from '@sdkit/sdk';

const sdkIt = new SdkIt({
  baseUrl: '/',
  token: '"<token>"',
});

const stream = await sdkIt.request('POST /generate', {
  specFile: new Blob(['example'], { type: 'text/plain' }),
});

for await (const chunk of stream) {
  console.log(chunk);
}
```

#### Input

Content Type: `multipart/form-data`

**Type:** [`PostGenerateInput`](#postgenerateinput)

#### Output

**200** - Response for 200

**Content Type:** `text/plain`

**Type:** [`PostGenerate`](#postgenerate)

**400** - Bad Request

**Content Type:** `application/json`

**Type:** [`PostGenerate400`](#postgenerate400)

### postPlayground | _POST /playground_

#### Example usage

```typescript
import { SdkIt } from '@sdkit/sdk';

const sdkIt = new SdkIt({
  baseUrl: '/',
  token: '"<token>"',
});

const result = await sdkIt.request('POST /playground', {
  specFile: new Blob(['example'], { type: 'text/plain' }),
});

console.log(result.data);
```

#### Input

Content Type: `multipart/form-data`

**Type:** [`PostPlaygroundInput`](#postplaygroundinput)

#### Output

**200** - Response for 200

**Content Type:** `application/json`

**Type:** [`PostPlayground`](#postplayground)

**400** - Bad Request

**Content Type:** `application/json`

**Type:** [`PostPlayground400`](#postplayground400)

### getOperations | _GET /operations_

#### Example usage

```typescript
import { SdkIt } from '@sdkit/sdk';

const sdkIt = new SdkIt({
  baseUrl: '/',
  token: '"<token>"',
});

const result = await sdkIt.request('GET /operations', {});

for await (const page of result) {
  console.log(page);
}
```

#### Input

Content Type: `application/empty`

**Type:** [`GetOperationsInput`](#getoperationsinput)

#### Output

**200** - Response for 200

**Content Type:** `application/json`

**Type:** [`GetOperations`](#getoperations)

**400** - Bad Request

**Content Type:** `application/json`

**Type:** [`GetOperations400`](#getoperations400)

## Schemas

<details>

<summary><h3 id="postpublish">PostPublish</h3></summary>

**Type:** `object`

**Properties:**

- `message` `string` required default: "SDK published successfully":

- `specUrl` `string` required:

</details>

<details>

<summary><h3 id="postpublish400">PostPublish400</h3></summary>

**Type:** [`ValidationError`](#validationerror)

</details>

<details>

<summary><h3 id="postpublishinput">PostPublishInput</h3></summary>

**Type:** `object`

**Properties:**

- `specUrl` `string` (format: uri) required:

</details>

<details>

<summary><h3 id="postaugment">PostAugment</h3></summary>

**Type:** `object`

**Additional Properties:**

- Allowed: true

</details>

<details>

<summary><h3 id="postaugment400">PostAugment400</h3></summary>

**Type:** [`ValidationError`](#validationerror)

</details>

<details>

<summary><h3 id="postaugmentinput">PostAugmentInput</h3></summary>

**Type:** `object`

**Properties:**

- `specUrl` `string` (format: uri) required:

</details>

<details>

<summary><h3 id="getfetch">GetFetch</h3></summary>

**Type:** `object`

**Additional Properties:**

- Allowed: true

</details>

<details>

<summary><h3 id="getfetch400">GetFetch400</h3></summary>

**Type:** [`ValidationError`](#validationerror)

</details>

<details>

<summary><h3 id="getfetchinput">GetFetchInput</h3></summary>

**Type:** `unknown`

</details>

<details>

<summary><h3 id="postgenerate">PostGenerate</h3></summary>

**Type:** `string`

</details>

<details>

<summary><h3 id="postgenerate400">PostGenerate400</h3></summary>

**Type:** [`ValidationError`](#validationerror)

</details>

<details>

<summary><h3 id="postgenerateinput">PostGenerateInput</h3></summary>

**Type:** `object`

**Properties:**

- `specFile` `string` (format: binary) required:

</details>

<details>

<summary><h3 id="postplayground">PostPlayground</h3></summary>

**Type:** `object`

**Properties:**

- `url` `string` required default: "https://raw.githubusercontent.com/openai/openai-openapi/refs/heads/master/openapi.yaml":

- `title` `string` required:

- `name` `string` required:

- `clientName` `string` required:

</details>

<details>

<summary><h3 id="postplayground400">PostPlayground400</h3></summary>

**Type:** [`ValidationError`](#validationerror)

</details>

<details>

<summary><h3 id="postplaygroundinput">PostPlaygroundInput</h3></summary>

**Type:** `object`

**Properties:**

- `specFile` `string` (format: binary) required:

</details>

<details>

<summary><h3 id="getoperations">GetOperations</h3></summary>

**Type:** `object`

**Properties:**

- `operations` `array` required:

**Array items:**

**Type:** `string`

- `pagination` `object` required:

**Properties:**

- `page` `number` required:

- `pageSize` `number` required:

- `totalItems` `number` required:

- `totalPages` `number` required:

- `hasNextPage` `boolean` required:

- `hasPreviousPage` `boolean` required:

</details>

<details>

<summary><h3 id="getoperations400">GetOperations400</h3></summary>

**Type:** [`ValidationError`](#validationerror)

</details>

<details>

<summary><h3 id="getoperationsinput">GetOperationsInput</h3></summary>

**Type:** `unknown`

</details>
