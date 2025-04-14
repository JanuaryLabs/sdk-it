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

<details>
<summary>Generate a Dart SDK (OpenStatus Example)</summary>

> **Note:** This uses the [OpenStatus](https://www.openstatus.dev/) public OpenAPI spec as an example.

```bash
npx @sdk-it/cli@latest dart \
  --spec https://api.openstatus.dev/v1/openapi \
  --output ./openstatus \
  --name OpenStatus \
  --mode full
```

This command creates a Dart package in the `./openstatus` directory.

</details>

### Add the SDK to Your Project

Add the generated SDK as a dependency in your `pubspec.yaml`:

```yaml
dependencies:
  openstatus_sdk:
    path: ./openstatus
```

Run `dart pub get` or `flutter pub get` to install dependencies.

### Create and Configure the Client

```dart
import 'package:openstatus_sdk/package.dart';

final openstatus = OpenStatus(Options(baseUrl: 'https://api.openstatus.dev/v1/'));
```

### Make an API Request

```dart
final status = await openstatus.statusReport.getStatusReport();
if (status != null) {
  print('Status: \\${status.summary}');
} else {
  print('Request failed');
}
```

### Format Generated Code

The generator can format the output using `dart format` automatically. You can also run it manually:

```bash
dart format ./openstatus
```

## Notes

- The Dart SDK generator creates a package structure compatible with Dart and Flutter projects.
- The generated code uses the `http` package for HTTP requests.
- Each API group (tag) is mapped to a Dart client class.
- The generator supports OpenAPI 3.0 and 3.1 specifications.
- For advanced usage, see the [TypeScript package documentation](../typescript/README.md) for general SDK-IT concepts.
