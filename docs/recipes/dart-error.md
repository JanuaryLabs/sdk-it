## Error Handling in SDK-IT Generated Dart Clients

SDK-IT generated Dart clients throw exceptions on API errors. Catch them with `try...catch`.

### Error Categories

Four error categories:

- **API Errors:** Thrown when the server responds with 4xx or 5xx. Each status code maps to a subclass of `ApiError` (e.g., `NotFoundError`, `BadRequestError`). All instances carry `message`, `statusCode`, and `status` from the response.

- **Client HTTP Exceptions:** The `http` package throws `http.ClientException` for protocol or I/O problems -- invalid URIs, malformed headers, or client-level I/O errors.

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

Thrown on protocol or I/O failures: invalid URI, malformed headers, or client I/O errors.

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

Thrown on low-level network failures: DNS lookup, TCP connection refused, no route to host, or network interface errors.

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

- `ApiError` subclasses are defined in `responses.dart` in the generated SDK.
