## Error Handling in SDK-IT Generated Clients

SDK-IT generated clients use exception-based error handling. The `client.request` method returns a promise that resolves with the response data on success (2xx HTTP status). If an error occurs, the method throws an exception that you can catch using `try...catch` blocks.

> [!IMPORTANT]
> Errors can occur before the request is sent (input validation) or after the request due to the server's response or network issues.

There are three main error categories:

1.  **Parse Errors (`ParseError`)**: These occur before the HTTP request if the input data fails validation against the endpoint's Zod input schema. A `ParseError` exception is thrown with a `data` property containing the flattened validation errors from Zod.

2.  **HTTP Errors (`APIError` subclasses)**: These occur after the HTTP request if the server responds with a non-2xx status code (4xx or 5xx). The thrown error is an instance of a specific `APIError` subclass (such as `NotFound` for 404, `BadRequest` for 400). These error objects have `status` (HTTP status code) and `data` (parsed error response body).

3.  **Network Errors**: These occur when the request cannot be completed due to network issues (DNS resolution failure, connection refused, timeouts, CORS issues). Standard JavaScript errors are thrown in these cases.

### Basic Error Handling

Each call to `client.request` returns a promise that resolves with the response data on success. Use `try...catch` blocks to handle errors:

```typescript
import { Client } from './client';

const client = new Client({ baseUrl: '...' });

try {
  const item = await client.request('GET /items/{id}', { id: '123' });
  console.log('Item fetched successfully:', item);
} catch (error) {
  // Handle any error (ParseError, APIError, or network errors)
  console.error('Error occurred:', error);
}
```

- If the request succeeds, the promise resolves with the parsed response data.
- If input validation fails before the request, a `ParseError` is thrown.
- If the API returns an error status code, a specific `APIError` subclass is thrown (e.g., `NotFound`, `BadRequest`).
- If a network error occurs, a standard JavaScript error is thrown.

### Handling Input Validation Errors (`ParseError`)

Before sending a request, the SDK validates input data against the Zod schema for the endpoint. If the input does not match the schema, the request is not sent and a `ParseError` is thrown.

The `error.data` property contains the flattened Zod validation errors.

```typescript
import { APIError, ParseError } from './client';

// Example: Sending invalid input (e.g., missing required field 'name')

try {
  const data = await client.request('POST /items', {
    description: 'Missing name',
  });
  console.log('Item created:', data);
} catch (error) {
  if (error instanceof ParseError) {
    // Input validation failed before sending the request
    console.error('Input Validation Error:', error.data);
    if (error.data.fieldErrors.name) {
      console.error(
        'Error for name field:',
        error.data.fieldErrors.name.join(', '),
      );
    }
    // Handle the validation error (e.g., show message to user)
  } else if (error instanceof APIError) {
    console.error(`API Error (${error.status}):`, error.data);
  } else {
    console.error('Unknown error type:', error);
  }
}
```

### Handling API Errors (4xx/5xx)

HTTP errors occur when the server responds with an error status code. Use `instanceof` within a `catch` block to check for specific `APIError` subclasses or the base `APIError` class.

```typescript
import {
  APIError,
  InternalServerError,
  NotFound,
  UnprocessableEntity,
} from './client';

try {
  const item = await client.request('GET /items/{id}', { id: '123' });
  console.log('Item retrieved:', item);
} catch (error) {
  if (error instanceof NotFound) {
    // TypeScript knows error.data matches the NotFound response schema
    console.error(`Resource not found (Status ${error.status}):`, error.data);
  } else if (error instanceof UnprocessableEntity) {
    console.error(`Validation failed (Status ${error.status}):`, error.data);
  } else if (error instanceof InternalServerError) {
    console.error(
      `Internal server error (Status ${error.status}):`,
      error.data,
    );
  } else if (error instanceof APIError) {
    // Handle other potential HTTP errors
    // All HTTP errors inherit from APIError
    console.error(
      `API request failed with status ${error.status}:`,
      error.data,
    );
  } else {
    console.error('Unexpected error type:', error);
  }
}
```

### Handling Network Errors

Network errors (e.g., DNS resolution failure, connection refused, timeouts, CORS issues in browsers) occur when the request cannot be completed. These are thrown as standard JavaScript errors and can be caught alongside other errors.

```typescript
import { APIError, ParseError } from './client';

try {
  const newItem = await client.request('POST /items', payload);
  console.log('Item created:', newItem);
} catch (error) {
  if (error instanceof ParseError) {
    console.error('Input Validation Error:', error.data);
  } else if (error instanceof APIError) {
    console.error(`API Error (${error.status}):`, error.data);
  } else {
    // Network or other unexpected errors
    console.error('Network or Fetch Error:', error);
  }
}
```

### Notes

- The `client.request` method returns a promise that resolves with the response data on success.
- Use `try...catch` blocks to handle all errors.
- `ParseError` is thrown before the request is sent when input validation fails. Access `error.data` for Zod validation details.
- `APIError` and its subclasses (such as `NotFound`, `Unauthorized`, `BadRequest`) are thrown when the server responds with an error status code.
- The possible error types for each endpoint are derived from the OpenAPI specification.
- Network-level errors (connection issues, DNS failures, CORS, timeouts) are thrown as standard JavaScript errors.
- Use `instanceof` checks to handle specific error types and provide appropriate error messages to users.
