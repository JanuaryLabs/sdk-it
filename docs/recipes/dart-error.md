## Error Handling in SDK-IT Generated Dart Clients

SDK-IT generated Dart clients handle API errors by throwing exceptions. This approach aligns with common Dart error handling practices using `try...catch` blocks.

### Error Categories

Errors encountered during API requests fall into several categories:

- **API Errors:** These occur when the API server responds with a non-successful HTTP status code (4xx or 5xx). The client throws an exception that extends the base `ApiError` class. Each specific HTTP error status corresponds to a distinct subclass (e.g., `NotFoundError`, `BadRequestError`). All `ApiError` instances contain `message`, `statusCode`, and `status` properties derived from the API response.

- **Client HTTP Exceptions:** These are thrown by the underlying `http` package for issues during the request process before a response is received or during response processing. `http.ClientException` is a common base class for these. Typical causes include invalid URIs, malformed headers, or other I/O errors within the HTTP client.

- **Socket Exceptions:** A specific type of I/O exception (`dart:io`) indicating network-level problems like DNS resolution failure or connection refusal.

- **Timeout Exceptions:** Thrown when a request does not complete within the specified duration, often managed using `.timeout()` on the Future.

### Handling Errors

Use a `try...catch` block to handle potential exceptions when making API calls. Catch specific error types for targeted handling or broader types like `ApiError`, `http.ClientException`, or `Exception` for more general cases.

```dart
import 'dart:async'; // For TimeoutException
import 'dart:io'; // For SocketException
import 'package:http/http.dart' as http; // For ClientException
import 'package:your_sdk_package/package.dart'; // Replace with your actual package import

void main() async {
  // Assume 'client' is an initialized instance of your generated SDK client
  final client = YourApiClient(Options(baseUrl: 'https://your.api.com'));

  try {
    // Example: Fetching a resource that might not exist, with a timeout
    final data = await client.resource.getResourceById('some-id')
        .timeout(const Duration(seconds: 10)); // Add timeout

    print('Resource fetched successfully: $data');

  // Handle API Errors - Not Found (404)
  } on NotFoundError catch (e) {
    print('API Error - Not Found (Status ${e.statusCode}): ${e.message}');
    // Optionally inspect e.data if the API provides details

  // Handle API Errors - Bad Request (400)
  } on BadRequestError catch (e) {
    print('API Error - Bad Request (Status ${e.statusCode}): ${e.message}');

  // Handle Other API Errors (4xx/5xx)
  } on ApiError catch (e) {
    print('API Error (${e.statusCode}): ${e.message}');

  // Handle Timeout Errors
  } on TimeoutException catch (_) {
    print('Network Error: The request timed out.');

  // Handle Network Errors (Socket Level)
  } on SocketException catch (e) {
    print('Network Error: Could not connect to the server. ${e.message}');

  // Handle HTTP Client Errors
  } on http.ClientException catch (e) {
    print('HTTP Client Error: ${e.message}');

  // Handle Unexpected Errors
  } catch (e) {
    print('An unexpected error occurred: $e');
  }
}
```

---

#### API Error

Use pattern matching to handle API errors (4xx, 5xx) that extend `ApiError`:

```dart
// ...existing imports...
try {
  // ...existing API call...
} catch (e) {
  switch (e) {
    case ApiError(statusCode: var code, message: var msg):
      print('API Error ($code): $msg');
      break;
    // ...other cases...
    default:
      print('An unexpected error occurred: $e');
  }
}
```

All API errors (including subclasses like `NotFoundError`, `BadRequestError`) will match this case.

#### ClientException

Handle HTTP client errors thrown by the `http` package:

This error fires when the HTTP client encounters protocol or I/O issues before or during parsing of the request/response cycle (e.g. invalid URI, malformed headers, internal client I/O errors).

```dart
// ...existing imports...
try {
  // ...existing API call...
} catch (e) {
  switch (e) {
    case http.ClientException(:var message):
      print('HTTP Client Error: $message');
      break;
    // ...other cases...
    default:
      print('An unexpected error occurred: $e');
  }
}
```

#### SocketException

Handle network-level errors such as DNS failures or connection refusals:

This error fires on low‑level network failures such as DNS lookup failures, TCP connection refusals, no route to host, or network interface issues.

```dart
// ...existing imports...
try {
  // ...existing API call...
} catch (e) {
  switch (e) {
    case SocketException(:var message):
      print('Network Error: Could not connect to the server. $message');
      break;
    // ...other cases...
    default:
      print('An unexpected error occurred: $e');
  }
}
```

#### TimeoutException

Handle request timeouts:

```dart
// ...existing imports...
try {
  // ...existing API call...
} catch (e) {
  switch (e) {
    case TimeoutException():
      print('Network Error: The request timed out.');
      break;
    // ...other cases...
    default:
      print('An unexpected error occurred: $e');
  }
}
```

#### Complete Example

You can combine all these cases in a single `switch` statement:

```dart
import 'dart:async';
import 'dart:io';
import 'package:http/http.dart' as http;
import 'package:your_sdk_package/package.dart'; // Replace with your actual package import

void main() async {
  final client = YourApiClient(Options(baseUrl: 'https://your.api.com'));

  try {
    final data = await client.resource.getResourceById('some-id')
        .timeout(const Duration(seconds: 10));
    print('Resource fetched successfully: $data');
  } catch (e) {
    switch (e) {
      case ApiError(statusCode: var code, message: var msg):
        print('API Error ($code): $msg');
        break;
      case http.ClientException(:var message):
        print('HTTP Client Error: $message');
        break;
      case SocketException(:var message):
        print('Network Error: Could not connect to the server. $message');
        break;
      case TimeoutException():
        print('Network Error: The request timed out.');
        break;
      default:
        print('An unexpected error occurred: $e');
    }
  }
}
```

---

### Notes

- API errors (4xx, 5xx status codes) result in exceptions extending `ApiError`.
- Network connectivity issues often manifest as `SocketException`.
- Failures within the HTTP client library might throw `http.ClientException`.
- Timeouts result in `TimeoutException`.
- Use `try...catch` blocks to handle these different error types appropriately.
- The specific `ApiError` subclasses are defined in the `responses.dart` file within the generated SDK.
