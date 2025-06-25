Of course. Based on the extensive source code you've provided, I have a deep understanding of your SDK generator's architecture, conventions, and patterns.

Here is a comprehensive, multi-phase prompt designed to guide an AI agent in adding a new language to your `sdk-it` tool. This prompt is structured to be a complete guide, referencing the existing TypeScript and Dart implementations as the source of truth.

---

## **Prompt: New Language Integration for SDK-IT Generator**

### **Agent Persona & Core Directive**

You are an expert polyglot software engineer and a core contributor to the `sdk-it` project. Your mission is to extend the `sdk-it` SDK generator to support a new target language. You will achieve this by meticulously analyzing the existing TypeScript and Dart generator implementations and creating a new, idiomatic generator for the specified language.

Your implementation must adhere to the project's architecture, conventions, and design principles. The ultimate goal is to produce a generated SDK that is type-safe, easy to use, and feels native to the target language's ecosystem.

### **Core Principles of SDK Generation**

You must adhere to the following principles:

1.  **Pattern Replication is Paramount:** The existing `packages/typescript` and `packages/dart` are your primary blueprints. Your new language generator **MUST** replicate their structure, logic, and file organization as closely as is idiomatically possible for the target language.
2.  **Idiomatic Code Generation:** The generated SDK must feel natural to a developer working in the target language. This includes correct naming conventions (e.g., `camelCase` vs. `snake_case`), error handling patterns (e.g., exceptions vs. result tuples), asynchronous programming models (e.g., `async/await`, `Promises`, `Futures`), and dependency management.
3.  **Type Safety is Non-Negotiable:** The primary value of `sdk-it` is generating type-safe clients. Your generator must correctly translate OpenAPI schemas into the target language's type system, ensuring that all operation inputs and outputs are strongly typed.
4.  **Minimal Dependencies:** The generated SDK should be lightweight. It should rely on a minimal, standard set of dependencies for the target language (typically just a core HTTP client library and any necessary JSON serialization helpers).
5.  **Comprehensive Documentation:** The generated code must be well-documented. Use the `description` and `summary` fields from the OpenAPI specification to generate code comments (e.g., JSDoc, KDoc, Docstrings) for all models, properties, and methods.

### **Project Architecture Overview**

Before you begin, you must understand the key packages in the monorepo:

*   `packages/spec`: This package is responsible for loading an OpenAPI specification and augmenting it with `x-` prefixed metadata (e.g., `x-inputname`, `x-response-name`, `x-pagination`). Your generator will consume this augmented spec.
*   `packages/core`: Contains shared utilities. You will not modify this.
*   `packages/cli`: The command-line interface. You will add a new command here to invoke your new language generator.
*   `packages/typescript`: The reference implementation for TypeScript. **Study this closely.** It demonstrates the core logic for file generation, schema emission (Zod for validation, interfaces for models), and HTTP request handling.
*   `packages/dart`: The reference implementation for Dart. This is your second blueprint, especially for understanding how to adapt the generation logic to a different language ecosystem (e.g., using `.txt` templates, different error handling, `pubspec.yaml`).

### **Agent Workflow: A Phased Approach**

You will implement the new language support in the following distinct phases.

---

#### **Phase 1: Project Setup & CLI Integration**

Your first step is to set up the necessary package structure and integrate your new generator into the main CLI tool.

1.  **Create the Language Package:**
    *   Create a new directory: `packages/<language-name>/`.
    *   Inside this directory, create a `src/` folder.
    *   Create a `README.md` file inside the package, following the structure of `packages/dart/README.md` or `packages/typescript/README.md`. It should explain how to generate and use the SDK for the new language.

2.  **Integrate with the CLI:**
    *   Create a new file: `packages/cli/src/lib/langs/<language-name>.ts`.
    *   Use `packages/cli/src/lib/langs/dart.ts` as a template.
    *   This file must define a new `commander` command for your language.
    *   The command's action handler **MUST** perform the following steps:
        1.  Accept the same core options: `--spec`, `--output`, `--name`.
        2.  Load the OpenAPI specification using `loadSpec` from `@sdk-it/spec`.
        3.  Augment the spec using `augmentSpec` from `@sdk-it/spec`. This step is crucial as it prepares the spec with the necessary metadata for your generator.
        4.  Invoke the main `generate` function from your new language package (which you will create in Phase 2).
        5.  Implement a post-generation formatting step using the idiomatic formatter for the target language (e.g., `gofmt` for Go, `cargo fmt` for Rust, `black` for Python). This should be executed via `execSync` or `execFile`, similar to the Dart and TypeScript commands.

---

#### **Phase 2: The Core Generator (`packages/<language-name>/src/lib/generate.ts`)**

This file is the main entry point for your language's generation logic. It orchestrates the entire process of creating the SDK files.

1.  **Create the `generate` function:** This function will accept the augmented OpenAPI spec and generator settings as arguments.
2.  **Orchestrate File Generation:** The `generate` function is responsible for creating the complete directory structure of the generated SDK. Based on the reference implementations, you **MUST** generate the following structure within the user's specified output directory:
    *   **Dependency File:** A language-appropriate dependency file (e.g., `pubspec.yaml`, `package.json`, `go.mod`, `Cargo.toml`, `requirements.txt`).
    *   `api/`: Contains the client classes for each API group (tag).
    *   `models/`: Contains the data models (interfaces, classes, structs) generated from the OpenAPI schemas.
    *   `inputs/`: Contains the input models/schemas for each operation.
    *   `outputs/`: Contains the output models/schemas for each operation's responses.
    *   `http/`: Contains the core HTTP transport logic, including the dispatcher, request/response objects, and interceptors.
    *   **Main Client File:** A root file that exports the main client class and other necessary components.

3.  **Use Static Template Files:** For boilerplate code that doesn't change based on the spec (like the HTTP dispatcher, interceptors, base response classes), you **MUST** use `.txt` files as templates.
    *   Create these `.txt` files within your `packages/<language-name>/src/lib/` directory.
    *   Your `generate` function will read these files and write them into the appropriate location in the generated SDK (e.g., `http/dispatcher.<ext>`).
    *   Reference `packages/dart/src/lib/generate.ts` and its use of `dispatcherTxt`, `interceptorsTxt`, etc.

---

#### **Phase 3: The Schema Emitter/Serializer**

This is the most critical component. You will create a class, similar to `DartSerializer` or the TypeScript `ZodEmitter`/`TypeScriptEmitter`, that is responsible for traversing the OpenAPI schema and converting it into the target language's code.

1.  **Create the Emitter Class:**
    *   Name it appropriately (e.g., `PythonEmitter`, `GoSerializer`).
    *   It must take the augmented OpenAPI spec in its constructor.

2.  **Implement Schema Traversal Logic:** The emitter's main `handle` method must be able to process any `SchemaObject` or `ReferenceObject`. It must correctly delegate to specialized methods based on the schema's properties.

3.  **Implement Type Handlers:** You must implement logic to handle:
    *   **Primitive Types:** `string`, `number`, `integer`, `boolean`.
    *   **Formats:** Correctly map formats like `date-time`, `uuid`, `binary`, `byte`, `int64` to idiomatic types in the target language (e.g., `DateTime`, `UUID`, `File`, `BigInt`).
    *   **Objects:** Generate classes, structs, or interfaces for `type: 'object'`. This includes handling `properties` and `required` fields.
    *   **Arrays:** Generate lists or arrays, correctly handling the `items` schema.
    *   **Enums & Consts:** Generate language-appropriate enums or unions of literal types.
    *   **Composition:**
        *   `allOf`: Translate to inheritance or composition (e.g., `extends` in Dart/TS, struct embedding in Go).
        *   `oneOf` / `anyOf`: Translate to sealed classes, interfaces with implementations, or tagged unions. You **MUST** use the `x-varients` metadata provided by `augmentSpec` to handle this correctly.
    *   **References (`$ref`):** Correctly resolve references using `followRef` and generate a reference to the corresponding generated model.
    *   **Nullability:** Correctly handle `nullable: true` or `type: ['string', 'null']` to produce optional or nullable types in the target language.

---

#### **Phase 4: HTTP Client & Request Logic**

This phase focuses on generating the code that makes the actual API calls.

1.  **Generate the Main Client Class:**
    *   Create a main client class (e.g., `MyApiClient`).
    *   It should be initialized with a base URL and any authentication options derived from the `securitySchemes`.
    *   It should instantiate and provide access to the API group clients (see below).

2.  **Generate API Group Clients:**
    *   For each `tag` in the OpenAPI spec, generate a separate client class (e.g., `UsersApi`, `PetsApi`).
    *   Each method in this class corresponds to an operation with that tag.

3.  **Generate Operation Methods:**
    *   For each operation, generate a method with a name derived from its `operationId`.
    *   The method signature must be strongly typed, accepting a single input object that contains all parameters (`path`, `query`, `header`, `body`).
    *   The method's return type must also be strongly typed.

4.  **Implement Request Serialization:**
    *   The method body must correctly construct the HTTP request.
    *   This includes:
        *   Replacing path parameters in the URL (e.g., `/users/{id}`).
        *   Adding query parameters to the URL.
        *   Adding headers.
        *   Serializing the request body based on the `Content-Type` (`application/json`, `multipart/form-data`, etc.).

5.  **Implement Response Deserialization & Error Handling:**
    *   This is a critical, language-specific decision.
    *   **Analyze the existing patterns:** TypeScript uses a `[result, error]` tuple. Dart `throws` exceptions.
    *   You must choose the most idiomatic approach for the new language and implement it consistently.
    *   Your implementation must handle different success (2xx) and error (4xx, 5xx) status codes, deserializing the response body into the correct success or error model.

---

#### **Phase 5: Final Deliverable**

Your final output should be a set of new and modified files that integrate the new language generator into the `sdk-it` project. You must provide the complete contents of each new file and clearly indicate any modifications to existing files.

**Example Structure of Deliverable:**

*   **New File:** `packages/cli/src/lib/langs/python.ts`
    ```typescript
    // ... full content of the new CLI command for Python ...
    ```
*   **New File:** `packages/python/src/lib/generate.ts`
    ```typescript
    // ... full content of the main Python generator orchestrator ...
    ```
*   **New File:** `packages/python/src/lib/python_emitter.ts`
    ```typescript
    // ... full content of the Python schema emitter ...
    ```
*   **New File:** `packages/python/src/lib/http/dispatcher.txt`
    ```python
    # ... full content of the static Python dispatcher ...
    ```
*   ... and so on for all other new files.
*   **Modified File:** `packages/cli/src/lib/cli.ts`
    ```diff
    --- a/packages/cli/src/lib/cli.ts
    +++ b/packages/cli/src/lib/cli.ts
    @@ -1,8 +1,10 @@
     #!/usr/bin/env node
     import { Command, program } from 'commander';

     import dart from './langs/dart.ts';
+    import python from './langs/python.ts';
     import typescript from './langs/typescript.ts';

     const generate = new Command('generate')
       .addCommand(typescript)
+      .addCommand(python)
       .addCommand(dart);
    ...
    ```