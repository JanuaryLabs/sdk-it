## Error Handling in SDK-IT Generated Clients

`client.request` resolves with response data on success (2xx) and throws on failure. Catch errors with `try...catch`.

> [!IMPORTANT]
> Errors can occur before the request (input validation) or after it (server response, network failure).

Three error categories:

1.  **Parse Errors (`ParseError`)**: Thrown before the HTTP request when input fails Zod schema validation. The `data` property contains flattened validation errors.

2.  **HTTP Errors (`APIError` subclasses)**: Thrown when the server responds with 4xx or 5xx. Each status code maps to a specific subclass (`NotFound` for 404, `BadRequest` for 400). Each error has `status` and `data` (parsed response body). The possible error types for each endpoint come from your OpenAPI specification.

3.  **Network Errors**: Thrown when the request cannot complete -- DNS failure, connection refused, timeout, or CORS block. These are standard JavaScript errors.

### Basic Error Handling

Use `try...catch` to handle errors from `client.request`:

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

- Success: resolves with parsed response data.
- Invalid input: throws `ParseError` before sending the request.
- Error status code: throws a specific `APIError` subclass (`NotFound`, `BadRequest`, etc.).
- Network failure: throws a standard JavaScript error.

### Handling Input Validation Errors (`ParseError`)

The SDK validates input against the endpoint's Zod schema before sending the request. Mismatched input throws a `ParseError` without sending the request. Access validation details through `error.data`.

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

The server signals errors with 4xx/5xx status codes. Use `instanceof` to check for specific `APIError` subclasses:

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

Network errors (DNS failure, connection refused, timeout, CORS) are standard JavaScript errors. Catch them alongside API errors:

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

