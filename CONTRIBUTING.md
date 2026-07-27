# Contributing to SDK-IT

Thank you for your interest in contributing to SDK-IT! This document provides information about the development process and codebase structure to help you get started.

## Development Overview

SDK-IT is built as a TypeScript monorepo using Nx for package management and build orchestration. The project is organized into several specialized packages that work together to provide a complete SDK generation solution.

## Interesting Techniques

- **TypeScript AST Manipulation**: Uses the [TypeScript Compiler API](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API) to analyze and transform TypeScript code. The toolkit traverses the Abstract Syntax Tree to extract type information, function signatures, and other metadata needed for SDK generation.

- **Symbol-based Type Serialization**: Implements a custom type derivation system using [JavaScript Symbols](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Symbol) for type metadata.

- **JSDoc Parsing**: Extracts API metadata from [JSDoc comments](https://jsdoc.app/) to enhance generated documentation, making the resulting SDK more developer-friendly.

- **Dynamic Code Generation**: Creates TypeScript interfaces and client code from OpenAPI specifications, with intelligent handling of complex types, inheritance, and polymorphism.

- **Monorepo Architecture**: Uses [Nx](https://nx.dev/) for managing a multi-package repository structure, enabling efficient dependency management and build processes.

- **Path Normalization**: Implements sophisticated path handling to ensure consistent file paths across different operating systems.

- **Response Analysis**: Automatically analyzes HTTP response structures to generate appropriate type definitions and parsing logic.

- **Template-based Code Generation**: Uses template files (like those in the `http` directory) to maintain consistent code structure while injecting dynamic content.

- **Visitor Pattern Implementation**: Employs the visitor pattern for traversing and transforming TypeScript ASTs.

- **Declarative API Definitions**: Supports extracting API definitions from declarative TypeScript code.

## Project Structure

```
.
├── .nx/                  # Generated Nx cache and workspace data
├── .verdaccio/           # Local npm registry configuration
├── .vscode/              # VS Code editor settings
├── node_modules/         # Project dependencies
├── packages/             # Core packages of the SDK-IT toolkit
│   ├── apiref/           # API reference web application (private)
│   ├── core/             # Core functionality and utilities
│   ├── cli/              # CLI and project generation workflow
│   ├── command/          # OpenAPI operation command builder
│   ├── dart/             # Dart SDK generator
│   ├── generic/          # Generic OpenAPI processing
│   ├── hono/             # Hono framework integration
│   ├── python/           # Python SDK generator
│   ├── readme/           # README generation
│   ├── rpc/              # Runtime RPC client and agent tools
│   ├── shadcn/           # Shared UI component library (private)
│   ├── spec/             # OpenAPI normalization and IR
│   ├── typescript/       # TypeScript SDK generator
│   └── vite/             # Vite generation plugin
├── package.json          # Root package configuration
├── nx.json               # Nx workspace configuration
├── tsconfig.base.json    # Base TypeScript configuration
├── tsconfig.json         # Project TypeScript configuration
├── eslint.config.mjs     # ESLint configuration
├── .prettierrc           # Prettier configuration
└── .gitignore            # Git ignore rules
```

## Package Details

The workspace contains twelve public packages and two private application/UI
packages:

| Package              | Role                                                            |
| -------------------- | --------------------------------------------------------------- |
| `@sdk-it/apiref`     | Private API reference web application                           |
| `@sdk-it/cli`        | CLI and TypeScript-backend project workflow                     |
| `@sdk-it/command`    | OpenAPI operation command builder                               |
| `@sdk-it/core`       | TypeScript analysis and shared low-level utilities              |
| `@sdk-it/dart`       | Dart SDK generator                                              |
| `@sdk-it/generic`    | Framework-agnostic TypeScript route analyzer                    |
| `@sdk-it/hono`       | Hono runtime and analyzer integration                           |
| `@sdk-it/python`     | Python SDK generator                                            |
| `@sdk-it/readme`     | Generated SDK documentation utilities                           |
| `@sdk-it/rpc`        | Runtime OpenAPI client and AI SDK tool builder                  |
| `@sdk-it/shadcn`     | Private shared UI component library                             |
| `@sdk-it/spec`       | OpenAPI loading, normalization, and intermediate representation |
| `@sdk-it/typescript` | TypeScript SDK generator                                        |
| `@sdk-it/vite`       | Vite integration for project or direct OpenAPI generation       |

### Core Package (`@sdk-it/core`)

The foundation of the SDK-IT toolkit, providing essential utilities and services used by all other packages:

- **Type Derivation System**: Analyzes TypeScript types and converts them to a serializable format
- **File System Operations**: Handles reading, writing, and managing files during the generation process
- **Path Utilities**: Normalizes and manages file paths across different operating systems
- **TypeScript Program Management**: Creates and manages TypeScript compiler instances for code analysis

### Generic Package (`@sdk-it/generic`)

Provides generic OpenAPI schema analysis and processing capabilities:

- **API Metadata Extraction**: Parses JSDoc comments to extract API metadata
- **Response Structure Analysis**: Analyzes response structures to generate appropriate types
- **Schema Transformation**: Converts OpenAPI schemas to TypeScript types

### Hono Package (`@sdk-it/hono`)

Specializes in generating SDKs for APIs built with the Hono web framework:

- **Hono-Specific Response Analysis**: Understands Hono's response patterns
- **Framework-Specific Optimizations**: Generates code optimized for Hono clients

### TypeScript Package (`@sdk-it/typescript`)

Focuses on generating TypeScript code from OpenAPI specifications:

- **Code Generation**: Creates TypeScript interfaces, types, and client code
- **Template-Based Generation**: Uses templates for consistent code structure
- **Documentation Generation**: Creates README and other documentation

## Technical Implementation Details

### Type Derivation System

The type derivation system is one of the most sophisticated components of SDK-IT. It uses the TypeScript Compiler API to analyze types and convert them into a serializable format that can be used for code generation. The system handles complex types including:

- **Primitive types**: string, number, boolean, null, undefined, any, unknown, never
- **Arrays and tuples**: Both fixed-length tuples and variable-length arrays
- **Objects and interfaces**: With support for optional properties, readonly properties, and index signatures
- **Unions and intersections**: Including discriminated unions and complex type combinations
- **Generics**: With support for type parameters, constraints, and defaults
- **Mapped types**: Including Record, Partial, Required, Pick, Omit, and custom mapped types
- **Conditional types**: Including complex type inference and distribution over unions
- **Literal types**: String literals, number literals, boolean literals, and template literal types
- **Function types**: With parameter types, return types, and overloads

### Response Analysis

The response analysis system examines the structure of API responses to generate appropriate type definitions and parsing logic. It supports:

- **JSON responses**: With automatic type inference and validation
- **Binary data**: Including ArrayBuffer, Blob, and typed arrays
- **Text responses**: With appropriate string handling
- **Custom content types**: With extensible parsing logic
- **Status codes**: Mapping different status codes to appropriate response types
- **Headers**: Extracting and validating header values
- **Error handling**: Generating appropriate error types and handling logic

### Code Generation

The code generation system uses a combination of templates and programmatically generated code to create:

- **Type definitions**: Interfaces, types, enums, and constants that match the API specification
- **API client classes**: With methods for each API operation
- **Request builders**: For constructing API requests with appropriate parameters
- **Response parsers**: For handling API responses and converting them to appropriate types
- **Error handling**: Including typed error responses and error classes
- **Documentation**: Including JSDoc comments, README files, and usage examples

### Integration with Build Systems

SDK-IT integrates with modern build systems through its Nx-based architecture:

- **Incremental builds**: Only regenerate SDKs when necessary
- **Parallel execution**: Generate multiple SDKs simultaneously
- **Caching**: Cache generation results for improved performance
- **Dependency tracking**: Automatically track dependencies between packages
- **Task orchestration**: Coordinate SDK generation with other build tasks

## Development Workflow

1. **Setup**: Clone the repository and run `npm ci` to install the lockfile exactly.
2. **Format**: Run `npm run format:check`.
3. **Lint**: Run `npm run lint` to run every package lint target.
4. **Typecheck**: Run `npm run typecheck`, or `nx run <project>:typecheck` for one package.
5. **Package tests**: Run `npm run test:packages`, or `nx run <project>:test` for one package. Package test targets build their dependencies first.
6. **Build**: Run `npm run build` to build every buildable project.
7. **Network E2E**: Run `npm run test:e2e` only when the external services and remote specs used by the root E2E suite are available. It is intentionally separate from the fast package-test path.
8. **Submit**: Create a pull request with your changes.

## Pull Request Process

1. Ensure your code follows the project's coding standards
2. Update documentation as necessary
3. Add tests for new functionality
4. Make sure all tests pass
5. Submit a pull request

## Code of Conduct

Please be respectful and considerate of others when contributing to this project. We strive to maintain a welcoming and inclusive environment for all contributors.
