## Error Handling in SDK-IT Generated Clients

SDK-IT generated clients use a structured approach to error handling. The `client.request` method returns a tuple: `[result, error]`. If the request succeeds (2xx HTTP status), `result` contains the data and `error` is `null`. If an error occurs, `result` is `null` and `error` contains an error object.

> [!IMPORTANT]
> Errors can occur before the request is sent (input validation) or after the request due to the server's response.

There are two main error categories:

1.  **Parse Errors (`ParseError`)**: These occur before the HTTP request if the input data fails validation against the endpoint's Zod input schema. The `error` object is a `ParseError` instance. It has a `data` property with the flattened validation errors from Zod.

2.  **HTTP Errors (`APIError` subclasses)**: These occur after the HTTP request if the server responds with a non-2xx status code (4xx or 5xx). The `error` object is an instance of a specific `APIError` subclass (such as `NotFound` for 404, `BadRequest` for 400). These error objects have `status` (HTTP status code) and `data` (parsed error response body).

### The `[result, error]` Tuple

Each call to `client.request` returns a promise that resolves to `[result, error]`.

```typescript
const [result, error] = await client.request('GET /items/{id}', { id: '123' });
```

- If the request succeeds, `result` contains the parsed response data and `error` is `null`.
- If input validation fails before the request, `result` is `null` and `error` is a `ParseError` instance.
- If the API returns an error status code, `result` is `null` and `error` is a specific `APIError` subclass (e.g., `NotFound`, `BadRequest`).

The first step in handling the response is always to check if the `error` element is null:

```typescript
import { Client } from './client';

const client = new Client({ baseUrl: '...' });
const [item, error] = await client.request('GET /items/{id}', { id });

if (error) {
  // Handle the error scenario (could be ParseError or APIError)
  console.error(`Error occurred:`, error);
} else {
  // If error is null, proceed with the successful result
  console.log('Item fetched successfully:', item);
}
```

### Handling Input Validation Errors (`ParseError`)

Before sending a request, the SDK validates input data against the Zod schema for the endpoint. If the input does not match the schema, the request is not sent. `client.request` returns `[null, error]` where `error` is a `ParseError` instance.

The `error.data` property in this case contains the flattened Zod validation errors.

```typescript
import { APIError, ParseError } from './client';

// Example: Sending invalid input (e.g., missing required field 'name')

const [data, error] = await client.request('POST /items', {
  description: 'Missing name',
});

if (!error) {
  console.log('Item created:', data);
} else {
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

HTTP errors occur when the server responds with an error status code. Use `instanceof` to check for specific `APIError` subclasses or the base `APIError` class.

```typescript
import { InternalServerError, NotFound, UnprocessableEntity } from './client';

if (error instanceof NotFound) {
  // TypeScript knows error.data matches the NotFound response schema
  console.error(`Resource not found (Status ${error.status}):`, error.data);
} else if (error instanceof UnprocessableEntity) {
  console.error(`Validation failed (Status ${error.status}):`, error.data);
} else if (error instanceof InternalServerError) {
  console.error(`Internal server error (Status ${error.status}):`, error.data);
} else if (error instanceof APIError) {
  // Handle other potential HTTP errors (e.g., 500 Internal Server Error)
  // All HTTP errors inherit from APIError
  console.error(`API request failed with status ${error.status}:`, error.data);
} else {
  console.error('Unexpected error type:', error);
}
```

### Handling Network Errors

Network errors (e.g., DNS resolution failure, connection refused, timeouts, CORS issues in browsers) occur before the client receives a response from the API server. These errors are not captured in the `error` part of the returned tuple. Instead, they cause the `fetch` call underlying `client.request` to throw an exception.

To handle these, use a standard `try...catch` block around the `await client.request` call:

```typescript
try {
  const [newItem, error] = await client.request('POST /items', payload);

  if (error) {
    if (error instanceof ParseError) {
      console.error('Input Error:', error.data);
    } else {
      console.error('API Error:', error.status, error.data);
    }
  }

  console.log('Item created:', newItem);
} catch (networkError) {
  console.error('Network or Fetch Error:', networkError);
}
```

### Notes

- The `client.request` method returns a tuple `[result, error]`.
- Always check if `error` is `null` to determine success or failure.
- If `error` is not `null`, it can be a `ParseError` (input validation failure) or a subclass of `APIError` (API response error).
- `ParseError` happens before the request is sent. Access `error.data` for Zod validation details.
- `APIError` and its subclasses (such as `NotFound`, `Unauthorized`) happen after the network call.
- The possible error types for each endpoint are derived from the OpenAPI specification.
- Network-level errors (connection issues, DNS failures, CORS) cause `client.request` to throw an exception. Use `try...catch` to handle these.
