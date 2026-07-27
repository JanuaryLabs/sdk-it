# @sdk-it/dart

A Dart SDK generator that converts OpenAPI specifications into type-safe Dart client libraries.

## Description

This package generates Dart client code from OpenAPI specifications. The generated SDK includes:

- Dart classes for API models
- API client classes for each tag/group
- Request and response handling
- Type-safe method signatures

## Installation

Add the generated SDK to your Dart or Flutter project. The generator will create a `pubspec.yaml` with required dependencies (such as `http` and `mime`).

## Usage

```bash
npx @sdk-it/cli@latest generate dart \
  --spec ./openapi.json \
  --output ./client_sdk \
  --name Client
```

This creates a Dart package in `./client_sdk`. The CLI runs `dart format`, so the Dart SDK must be installed.

### Add the SDK to Your Project

Add the generated SDK as a dependency in your `pubspec.yaml`:

```yaml
dependencies:
  client_sdk:
    path: ./client_sdk
```

Run `dart pub get` or `flutter pub get` to install dependencies.

### Create and Configure the Client

```dart
import 'package:client_sdk/package.dart';

final client = Client(Options(baseUrl: 'https://api.example.com'));
```

### Make an API Request

Generated operations are grouped by their first OpenAPI tag and named from their `operationId`. Use the emitted signatures in `lib/api/`; methods return their generated `Future<T>` type and throw `ApiError` subclasses for non-successful responses.

### Format Generated Code

The generator can format the output using `dart format` automatically. You can also run it manually:

```bash
dart format ./client_sdk
```

## Notes

- Supports OpenAPI 3.0 and 3.1 specifications.
- For advanced usage, see the [TypeScript package documentation](../typescript/README.md) for general SDK-IT concepts.
