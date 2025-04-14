## Error Handling in SDK-IT Generated Clients

SDK-IT generated clients provide a structured approach to error handling. When you make a request using the `client.request` method, it returns a tuple: `[result, error]`. If the request is successful (typically a 2xx HTTP status), `result` contains the data, and `error` is `null`. If an error occurs, `result` is `null`, and `error` contains an error object.

> [!IMPORTANT]
> It is helpful to distinguish between errors that occur _before_ the request is sent (input validation) and errors that occur _after_ the request due to the server's response.

There are two primary categories of errors:

1.  **Parse Errors (`ParseError`)**: These occur exclusively **before** the HTTP request is sent if the input data provided to the `client.request` method fails validation against the endpoint's Zod input schema. The `error` object is an instance of `ParseError`. It contains a `data` property holding the flattened validation errors from Zod.

2.  **HTTP Errors (`APIError` subclasses)**: These occur **after** the HTTP request is sent if the server responds with a non-2xx status code (e.g., 4xx or 5xx). The `error` object is an instance of a specific subclass of `APIError` corresponding to the HTTP status code (e.g., `NotFound` for 404, `BadRequest` for 400). These error objects contain `status` (the HTTP status code) and `data` (the parsed error response body).

### The `[result, error]` Tuple

Every call to `client.request` returns a promise that resolves to a tuple: `[result, error]`.

```typescript
const [result, error] = await client.request('GET /items/{id}', { id: '123' });
```

- If the request is successful (input validation passes and API returns a 2xx status code), `result` will contain the parsed response data, and `error` will be `null`.
- If input validation fails _before_ the request is sent, `result` will be `null`, and `error` will be an instance of `ParseError`.
- If the API returns an error status code (4xx or 5xx), `result` will be `null`, and `error` will be an instance of a specific `APIError` subclass (e.g., `NotFound`, `BadRequest`).

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

Before sending a request, the SDK validates the input data against the Zod schema defined for the endpoint. If the input does not match the schema, the request is not sent, and `client.request` returns `[null, error]` where `error` is an instance of `ParseError`.

The `error.data` property in this case contains the flattened Zod validation errors.

```typescript
// Adjust import paths based on your generated SDK structure
import { ParseError } from './client/http/parser';
import { APIError } from './client/http/response'; // Base class for API errors

// ... inside an async function

// Example: Sending invalid input (e.g., missing required field 'name')
const [data, error] = await client.request('POST /items', { description: 'Missing name' });

if (error) {
  if (error instanceof ParseError) {
    // Input validation failed before sending the request
    console.error('Input Validation Error:', error.data);
    // error.data structure: { formErrors: string[], fieldErrors: { [field: string]: string[] } }
    if (error.data.fieldErrors.name) {
      console.error('Specific error for name field:', error.data.fieldErrors.name.join(', '));
    }
    // Handle the validation error (e.g., show message to user)
  } else if (error instanceof APIError) {
    // Handle API errors (4xx, 5xx) as shown previously
    console.error(`API Error (${error.status}):`, error.data);
  } else {
    // Should not happen, but good for completeness
    console.error('Unknown error type:', error);
  }
  // Return or throw based on the error type
  return null;
}

// Process successful data
console.log('Item created:', data);
```

<!-- ### Handling HTTP Errors -->

### Handling API Errors (4xx/5xx)

HTTP errors occur when the server responds with an error status code. Use `instanceof` to check for specific `APIError` subclasses (like `NotFound`, `Unauthorized`) or the base `APIError` class for general HTTP errors.

```typescript
// Adjust import path based on your generated SDK structure
import { InternalServerError, NotFound, UnprocessableEntity } from './client';

// ... inside an async function where error is known NOT to be ParseError

if (error instanceof NotFound) {
  // TypeScript knows error.data matches the NotFound response schema
  console.error(`Resource not found (Status ${error.status}):`, error.data);
} else if (error instanceof UnprocessableEntity) {
  // TypeScript knows error.data matches the UnprocessableEntity response schema
  console.error(`Validation failed (Status ${error.status}):`, error.data);
} else if (error instanceof InternalServerError) {
  console.error(`Internal server error (Status ${error.status}):`, error.data);
} else if (error instanceof APIError) {
  // Handle other potential HTTP errors (e.g., 500 Internal Server Error)
  // All HTTP errors inherit from APIError
  console.error(`API request failed with status ${error.status}:`, error.data);
} else {
  // Fallback for unexpected error types (should not happen for HTTP errors)
  console.error('An unexpected error occurred:', error);
}
```

### Handling Network Errors

Network errors (e.g., DNS resolution failure, connection refused, timeouts, CORS issues in browsers) occur before the client receives a response from the API server. These errors are not captured in the `error` part of the returned tuple. Instead, they cause the `fetch` call underlying `client.request` to throw an exception.

To handle these, use a standard `try...catch` block around the `await client.request` call:

```typescript
async function createItemSafe(payload: { name: string }) {
  try {
    const [newItem, error] = await client.request('POST /items', payload);

    if (error) {
      // Handle ParseError or APIError as shown above
      if (error instanceof ParseError) {
        console.error(`Input Error:`, error.data);
      } else {
        // Must be APIError
        console.error(`API Error: ${error.status}`, error.data);
      }
      return null;
    }

    // Success
    console.log('Item created:', newItem);
    return newItem;
  } catch (networkError) {
    // Handle network/fetch errors
    console.error('Network or Fetch Error:', networkError);
    return null;
  }
}
```

### Notes

- The `client.request` method returns a tuple `[result, error]`.
- Always check if the `error` element is `null` to determine success or failure.
- If `error` is not `null`, it can be an instance of `ParseError` (input validation failure) or a subclass of `APIError` (API response error).
- `ParseError` happens _before_ the request is sent. Access `error.data` for Zod validation details.
- `APIError` and its subclasses (e.g., `NotFound`, `Unauthorized`) happens after the network call.
- The possible error types for each endpoint are derived from the OpenAPI specification.
- Network-level errors (connection issues, DNS failures, CORS) cause `client.request` to throw an exception. Use `try...catch` around the `await` call to handle these.
