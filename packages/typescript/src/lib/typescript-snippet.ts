import type { ResponseObject, SchemaObject } from 'openapi3-ts/oas31';
import { camelcase, spinalcase } from 'stringcase';

import {
  type OpenAPISecuritySchemeObject,
  isEmpty,
  pascalcase,
  resolveRef,
} from '@sdk-it/core';
import { type Generator } from '@sdk-it/readme';
import {
  type IR,
  type OperationEntry,
  type OperationPagination,
  type TunedOperationObject,
  forEachOperation,
  patchParameters,
} from '@sdk-it/spec';

import { SnippetEmitter } from './emitters/snippet.ts';
import type { TypeScriptGeneratorOptions } from './options.ts';
import { expandServerUrls } from './server-urls.ts';

export class TypeScriptSnippet implements Generator {
  #spec: IR;
  #snippetEmitter: SnippetEmitter;
  #clientName: string;
  #packageName: string;
  constructor(spec: IR, settings: TypeScriptGeneratorOptions) {
    this.#spec = spec;
    this.#snippetEmitter = new SnippetEmitter(spec);
    this.#clientName = settings.name?.trim()
      ? pascalcase(settings.name)
      : 'Client';

    this.#packageName = settings.name
      ? `@${spinalcase(this.#clientName.toLowerCase())}/sdk`
      : 'sdk';
  }
  succinct(
    entry: OperationEntry,
    operation: TunedOperationObject,
    values: {
      requestBody?: Record<string, unknown>;
      pathParameters?: Record<string, unknown>;
      queryParameters?: Record<string, unknown>;
      headers?: Record<string, unknown>;
      cookies?: Record<string, unknown>;
    },
  ) {
    let payload = '{}';
    if (!isEmpty(operation.requestBody)) {
      const contentTypes = Object.keys(operation.requestBody.content || {});
      const schema = resolveRef(
        this.#spec,
        operation.requestBody.content[contentTypes[0]].schema,
      );

      const examplePayload = this.#snippetEmitter.handle({
        ...schema,
        properties: Object.assign({}, schema.properties, schema.properties),
      });
      // merge explicit values into the example payload
      Object.assign(
        examplePayload as Record<string, unknown>,
        values.requestBody ?? {},
        values.pathParameters ?? {},
        values.queryParameters ?? {},
        values.headers ?? {},
        values.cookies ?? {},
      );
      payload = examplePayload as any;
    } else {
      const requestBody: SchemaObject = { type: 'object', properties: {} };
      patchParameters(this.#spec, requestBody, operation.parameters);
      const examplePayload = this.#snippetEmitter.handle(requestBody);
      // merge explicit values into the example payload
      Object.assign(
        examplePayload as Record<string, unknown>,
        values.pathParameters ?? {},
        values.queryParameters ?? {},
        values.headers ?? {},
        values.cookies ?? {},
      );
      payload = examplePayload as any;
    }
    payload = JSON.stringify(
      payload,
      (key, value) => {
        if (value?.startsWith && value.startsWith('new')) {
          return `__REPLACE_${Math.random().toString(36).substring(2, 11)}__${value}__REPLACE_END__`;
        }
        return value;
      },
      2,
    ).replace(/"__REPLACE_[^"]*__([^"]*?)__REPLACE_END__"/g, '$1');

    let successResponse: ResponseObject | undefined;
    for (const status in operation.responses) {
      if (status.startsWith('2')) {
        successResponse = operation.responses[status] as ResponseObject;
        break;
      }
    }

    if (successResponse) {
      if (successResponse.headers?.['Transfer-Encoding']) {
        return this.#httpStreaming(entry, payload);
      }
      if (
        successResponse.content &&
        successResponse.content['application/octet-stream']
      ) {
        return this.#streamDownload(entry, payload);
      }
    }

    if (!isEmpty(operation['x-pagination'])) {
      return this.#pagination(operation, entry, payload);
    }
    return this.#normal(entry, payload);
  }

  #pagination(
    operation: TunedOperationObject,
    entry: OperationEntry,
    payload: string,
  ) {
    const pagination: OperationPagination = operation['x-pagination'];
    switch (pagination.type) {
      case 'page':
        return {
          content: `const controller = new AbortController();\nconst result = await ${camelcase(this.#clientName)}.request('${entry.method.toUpperCase()} ${entry.path}', ${payload}, { signal: controller.signal });`,
          footer: `for await (const page of result.iter({ signal: controller.signal })) {\n\t\tconsole.log(page);\n}`,
        };
      case 'offset':
        return {
          content: `const controller = new AbortController();\nconst result = await ${camelcase(this.#clientName)}.request('${entry.method.toUpperCase()} ${entry.path}', ${payload}, { signal: controller.signal });`,
          footer: `for await (const page of result.iter({ signal: controller.signal })) {\n\t\tconsole.log(page);\n}`,
        };
      case 'cursor':
        return {
          content: `const controller = new AbortController();\nconst result = await ${camelcase(this.#clientName)}.request('${entry.method.toUpperCase()} ${entry.path}', ${payload}, { signal: controller.signal });`,
          footer: `for await (const page of result.iter({ signal: controller.signal })) {\n\t\tconsole.log(page);\n}`,
        };
    }
    return this.#normal(entry, payload);
  }

  #normal(entry: OperationEntry, payload: string) {
    return {
      content: `const result = ${this.#toRequest(entry, payload)};`,
      footer: 'console.log(result.data)',
    };
  }

  #streamDownload(entry: OperationEntry, payload: string) {
    return {
      content: `const stream = ${this.#toRequest(entry, payload)}`,
      footer: `await writeFile('./report.pdf', stream);`,
    };
  }

  #httpStreaming(entry: OperationEntry, payload: string) {
    return {
      content: `const stream = ${this.#toRequest(entry, payload)}`,
      footer: `for await (const chunk of stream) {\n\t\tconsole.log(chunk);\n}`,
    };
  }

  #toRequest(entry: OperationEntry, payload: string) {
    return `await ${camelcase(this.#clientName)}.request('${entry.method.toUpperCase()} ${entry.path}', ${payload});`;
  }

  snippet(
    entry: OperationEntry,
    operation: TunedOperationObject,
    config: Record<string, unknown> = {},
  ) {
    const payload = this.succinct(entry, operation, config);
    const content: string[] = [
      this.client(),
      '',
      payload.content,
      '',
      payload.footer,
    ];
    if (config.frame !== false) {
      return createCodeBlock('typescript', content);
    }
    return content.join('\n');
  }

  #authentication() {
    const names = new Set<string>();
    for (const requirement of this.#spec.security ?? []) {
      for (const name of Object.keys(requirement)) names.add(name);
    }
    forEachOperation(this.#spec, (_entry, operation) => {
      for (const requirement of operation.security ?? []) {
        for (const name of Object.keys(requirement)) names.add(name);
      }
    });
    return [...names].flatMap((name) => {
      // Requirement names may be external URI references with no local scheme.
      const scheme = this.#spec.components.securitySchemes[name];
      return scheme
        ? [
            {
              name,
              scheme: resolveRef<OpenAPISecuritySchemeObject>(
                this.#spec,
                scheme,
              ),
            },
          ]
        : [];
    });
  }

  #credentialExample(
    scheme: OpenAPISecuritySchemeObject,
  ): string | boolean | { username: string; password: string } {
    if (scheme.type === 'mutualTLS') return true;
    if (scheme.type === 'http' && scheme.scheme?.toLowerCase() === 'basic') {
      return { username: 'user', password: 'password' };
    }
    if (scheme.type === 'apiKey') return 'test_api_key_1234567890abcdef';
    return 'test_access_token_1234567890abcdef';
  }

  client() {
    const servers = expandServerUrls(this.#spec.servers ?? []);
    const options: Record<string, unknown> = {};
    if (servers.length !== 1) {
      options.baseUrl = servers[0] ?? 'http://localhost:3000';
    }

    const authOptions = this.#authentication();
    if (!isEmpty(authOptions)) {
      const [firstAuth] = authOptions;
      options.credentials = {
        [firstAuth.name]: this.#credentialExample(firstAuth.scheme),
      };
    }

    const client = this.#constructClient(options);
    return `${client.import}\n\n${client.use}`;
  }

  #constructClient(options: Record<string, unknown> = {}) {
    return {
      import: `import { ${this.#clientName} } from '${this.#packageName}';`,
      use: `const ${camelcase(this.#clientName)} = new ${this.#clientName}({\n\t\t${Object.entries(
        options,
      )
        .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
        .join(',\n\t\t')}\n\t});`,
    };
  }

  clientInstallDocs(): string {
    const sections: string[] = [];

    sections.push('## Installation');
    sections.push('');
    sections.push(
      createCodeBlock('bash', [`npm install ${this.#packageName}`]),
    );
    sections.push('');

    sections.push('## Basic Usage');
    sections.push('');
    sections.push(createCodeBlock('typescript', [this.client()]));

    return sections.join('\n');
  }

  configurationOptions(): {
    sections: string[];
    hasServers: boolean;
    baseUrl: string;
    hasApiKey: boolean;
  } {
    const sections: string[] = [];
    const hasServers = Boolean(
      this.#spec.servers && this.#spec.servers.length > 0,
    );
    const baseUrl =
      expandServerUrls(this.#spec.servers ?? [])[0] ||
      'https://api.example.com';

    const authOptions = this.#authentication();
    const hasApiKey = !isEmpty(authOptions);

    sections.push('### Configuration Options');
    sections.push('');
    sections.push('| Option | Type | Required | Description |');
    sections.push('|--------|------|----------|-------------|');
    sections.push(
      '| `fetch` | `fetch compatible` | No | Fetch implementation to use for HTTP requests |',
    );

    if (hasServers) {
      sections.push(
        '| `baseUrl` | `string | (() => string | Promise<string>)` | No | API base URL (default: `' +
          baseUrl +
          '`) |',
      );
    }

    if (hasApiKey) {
      sections.push(
        '| `credentials` | `Record<string, SecurityCredential>` | No | Credentials keyed by the exact OpenAPI security scheme name |',
      );
    }

    return { sections, hasServers, baseUrl, hasApiKey };
  }

  clientSetupDocs(): string {
    const sections: string[] = [];

    // Use the dedicated install docs method
    sections.push(this.clientInstallDocs());
    sections.push('');

    // Use the configuration options method
    const config = this.configurationOptions();
    sections.push(...config.sections);
    sections.push('');

    // Add configuration update documentation
    sections.push(this.configurationUpdateDocs());

    return sections.join('\n');
  }

  paginationDocs(): string {
    const paginationTypes = availablePaginationTypes(this.#spec);

    if (
      !paginationTypes.offset &&
      !paginationTypes.page &&
      !paginationTypes.cursor
    ) {
      return '';
    }

    const sections: string[] = [];

    sections.push('## Pagination');
    sections.push('');
    sections.push(
      'This SDK automatically handles pagination for endpoints that return multiple items.',
    );
    sections.push('');
    sections.push('### How it Works');
    sections.push('');
    sections.push(
      'When you call a paginated endpoint, the SDK returns a pagination object that allows you to iterate through all results:',
    );
    sections.push('');

    // Generate examples for each available pagination type
    const availableTypes: Array<'offset' | 'page' | 'cursor'> = [];
    if (paginationTypes.offset) availableTypes.push('offset');
    if (paginationTypes.page) availableTypes.push('page');
    if (paginationTypes.cursor) availableTypes.push('cursor');

    // Use the first available type for the main example
    const primaryPaginationType = availableTypes[0];
    const mockPaginatedOperation = {
      'x-pagination': { type: primaryPaginationType },
      tags: ['Products'],
      operationId: 'listProducts',
      parameters: [],
      'x-fn-name': 'listProducts',
      responses: {},
      requestBody: {} as TunedOperationObject['requestBody'],
    } as TunedOperationObject;
    const mockOperationEntry = {
      method: 'get' as const,
      path: '/products',
      tag: 'Products',
    } as OperationEntry;
    const initialRequestPayload = createObjectLiteral({ limit: 20 });
    const paginationExample = this.#pagination(
      mockPaginatedOperation,
      mockOperationEntry,
      initialRequestPayload,
    );

    sections.push(
      createCodeBlock('typescript', [
        '// The SDK automatically handles pagination',
        paginationExample.content,
        '',
        '// Access the current page data',
        'const currentPage = result.getCurrentPage();',
        'console.log(currentPage.data); // Array of product items',
        '',
        '// Check if more pages exist',
        'if (result.hasMore) {',
        '  await result.getNextPage({ signal: controller.signal });',
        '}',
        '',
        '// Or iterate through all pages with cancellable page fetches',
        paginationExample.footer,
      ]),
    );
    sections.push('');

    sections.push('### Iterating Through All Pages');
    sections.push('');

    const iterationExample = this.#pagination(
      mockPaginatedOperation,
      mockOperationEntry,
      createObjectLiteral({ limit: 100 }),
    );
    sections.push(
      createCodeBlock('typescript', [
        '// Using async iteration to process all pages',
        iterationExample.content,
        '',
        iterationExample.footer,
      ]),
    );
    sections.push('');

    // Show pagination types section with examples for each available type
    if (availableTypes.length > 1) {
      sections.push('### Pagination Types');
      sections.push('');
      sections.push(
        'Your API uses the following pagination strategies, automatically detected by the SDK:',
      );
      sections.push('');
    } else {
      sections.push('### Pagination Strategy');
      sections.push('');
      sections.push(
        'Your API uses the following pagination strategy, automatically detected by the SDK:',
      );
      sections.push('');
    }

    // Generate specific examples for each available pagination type
    for (const paginationType of availableTypes) {
      const typeSpecificOperation = {
        'x-pagination': { type: paginationType },
        tags: ['Products'],
        operationId: 'listProducts',
        parameters: [],
        'x-fn-name': 'listProducts',
        responses: {},
        requestBody: {} as TunedOperationObject['requestBody'],
      } as TunedOperationObject;

      const typeSpecificEntry = {
        method: 'get' as const,
        path: '/products',
        tag: 'Products',
      } as OperationEntry;

      if (paginationType === 'cursor') {
        sections.push('#### Cursor Pagination');
        sections.push('');
        sections.push('Uses a cursor token to fetch the next page:');
        sections.push('');

        const cursorPaginationExample = this.#pagination(
          typeSpecificOperation,
          typeSpecificEntry,
          createObjectLiteral({ limit: 20 }),
        );

        sections.push(
          createCodeBlock('typescript', [
            cursorPaginationExample.content,
            '',
            '// Iterate through all pages using cursor',
            cursorPaginationExample.footer,
          ]),
        );
        sections.push('');
      }
      if (paginationType === 'offset') {
        sections.push('#### Offset Pagination');
        sections.push('');
        sections.push('Uses offset and limit parameters:');
        sections.push('');

        const offsetPaginationExample = this.#pagination(
          typeSpecificOperation,
          typeSpecificEntry,
          createObjectLiteral({ limit: 20, offset: 0 }),
        );

        sections.push(
          createCodeBlock('typescript', [
            offsetPaginationExample.content,
            '',
            '// Iterate through all pages using offset',
            offsetPaginationExample.footer,
          ]),
        );
        sections.push('');
      }
      if (paginationType === 'page') {
        sections.push('#### Page Pagination');
        sections.push('');
        sections.push('Uses page number and page size:');
        sections.push('');

        const pagePaginationExample = this.#pagination(
          typeSpecificOperation,
          typeSpecificEntry,
          createObjectLiteral({ page: 1, pageSize: 20 }),
        );

        sections.push(
          createCodeBlock('typescript', [
            pagePaginationExample.content,
            '',
            '// Iterate through all pages using page numbers',
            pagePaginationExample.footer,
          ]),
        );
        sections.push('');
      }
    }

    if (availableTypes.length > 1) {
      sections.push(
        'The SDK handles the differences transparently, providing a consistent interface regardless of the underlying pagination type.',
      );
    }

    return sections.join('\n');
  }

  errorHandlingDocs(): string {
    const sections: string[] = [];

    sections.push('## Error Handling');
    sections.push('');
    sections.push(
      'The SDK provides structured error handling with typed HTTP error responses.',
    );
    sections.push('');

    sections.push('### Error Response Types');
    sections.push('');
    sections.push(
      'All API errors extend from `APIError` and include the HTTP status code and response data:',
    );
    sections.push('');
    sections.push(
      createCodeBlock('typescript', [
        `import { BadRequest, Unauthorized, NotFound, TooManyRequests, InternalServerError, ParseError } from "${this.#packageName}";`,
        'try {',
        'const usersList = ',
        this.#toRequest(
          {
            method: 'get',
            path: '/users',
            tag: 'Users',
          },
          createObjectLiteral({}),
        ),
        '  // Handle successful response',
        '} catch (error) {',
        '  // Handle different error types',
        '  if (error instanceof BadRequest) {',
        '    console.error("Bad request:", error.data);',
        '    console.log("Status:", error.status); // 400',
        '  } else if (error instanceof Unauthorized) {',
        '    console.error("Authentication failed:", error.data);',
        '    console.log("Status:", error.status); // 401',
        '  } else if (error instanceof NotFound) {',
        '    console.error("Resource not found:", error.data);',
        '    console.log("Status:", error.status); // 404',
        '  } else if (error instanceof TooManyRequests) {',
        '    console.error("Rate limited:", error.data);',
        '    if (error.data.retryAfter) {',
        '      console.log("Retry after:", error.data.retryAfter);',
        '    }',
        '  } else if (error instanceof InternalServerError) {',
        '    console.error("Server error:", error.data);',
        '    console.log("Status:", error.status); // 500',
        '  } else if (error instanceof ParseError) {',
        '    console.error("Input validation failed:", error.data);',
        '  }',
        '}',
      ]),
    );
    sections.push('');

    sections.push('### Available Error Classes');
    sections.push('');
    sections.push('#### Input Validation Errors');
    sections.push(
      '- `ParseError` - Request input validation failed against API schema',
    );
    sections.push('');
    sections.push('#### Client Errors (4xx)');
    sections.push('- `BadRequest` (400) - Invalid request data');
    sections.push('- `Unauthorized` (401) - Authentication required');
    sections.push('- `PaymentRequired` (402) - Payment required');
    sections.push('- `Forbidden` (403) - Access denied');
    sections.push('- `NotFound` (404) - Resource not found');
    sections.push('- `MethodNotAllowed` (405) - HTTP method not allowed');
    sections.push('- `NotAcceptable` (406) - Content type not acceptable');
    sections.push('- `Conflict` (409) - Resource conflict');
    sections.push('- `Gone` (410) - Resource no longer available');
    sections.push('- `PreconditionFailed` (412) - Precondition failed');
    sections.push('- `PayloadTooLarge` (413) - Request payload too large');
    sections.push('- `UnsupportedMediaType` (415) - Unsupported content type');
    sections.push('- `UnprocessableEntity` (422) - Validation errors');
    sections.push('- `TooManyRequests` (429) - Rate limit exceeded');
    sections.push('');

    sections.push('#### Server Errors (5xx)');
    sections.push('- `InternalServerError` (500) - Server error');
    sections.push('- `NotImplemented` (501) - Not implemented');
    sections.push('- `BadGateway` (502) - Bad gateway');
    sections.push('- `ServiceUnavailable` (503) - Service unavailable');
    sections.push('- `GatewayTimeout` (504) - Gateway timeout');
    sections.push('');

    sections.push('### Validation Errors');
    sections.push('');
    sections.push(
      'Validation errors (422) include detailed field-level error information:',
    );

    sections.push('### Input Validation Errors');
    sections.push('');
    sections.push(
      'When request input fails validation against the API schema, a `ParseError` is thrown:',
    );
    sections.push('');
    sections.push(
      createCodeBlock('typescript', [
        `import { ParseError } from "${this.#packageName}";`,
        '',
        'try {',
        "  // Invalid input that doesn't match the expected schema",
        '  const newUser = ',
        this.#toRequest(
          {
            method: 'post',
            path: '/users',
            tag: 'Users',
          },
          createObjectLiteral({
            email: 123, // should be string
            firstName: '', // empty required field
            age: -5, // invalid age value
          }),
        ),
        '} catch (error) {',
        '  if (error instanceof ParseError) {',
        '    console.log("Input validation failed:");',
        '    ',
        '    // Field-level errors',
        '    if (error.data.fieldErrors) {',
        '      Object.entries(error.data.fieldErrors).forEach(([fieldName, validationIssues]) => {',
        '        console.log(`  ${fieldName}: ${validationIssues.map(issue => issue.message).join(", ")}`);',
        '      });',
        '    }',
        '    ',
        '    // Form-level errors',
        '    if (error.data.formErrors.length > 0) {',
        '      console.log(`  Form errors: ${error.data.formErrors.map(issue => issue.message).join(", ")}`);',
        '    }',
        '  }',
        '}',
      ]),
    );
    sections.push('');
    sections.push(
      "`ParseError` contains detailed validation information using Zod's flattened error format, providing specific field-level and form-level validation messages.",
    );
    sections.push('');

    sections.push('### Rate Limiting');
    sections.push('');
    sections.push(
      'Rate limit responses may include a `retryAfter` field indicating when to retry:',
    );
    sections.push('');
    sections.push(
      createCodeBlock('typescript', [
        `import { TooManyRequests } from "${this.#packageName}";`,
        '',
        'try {',
        '  const apiResponse = ',
        this.#toRequest(
          {
            method: 'get',
            path: '/api/data',
            tag: 'Data',
          },
          createObjectLiteral({}),
        ),
        '} catch (error) {',
        '  if (error instanceof TooManyRequests) {',
        '    const retryAfterSeconds = error.data.retryAfter;',
        '    if (retryAfterSeconds) {',
        '      console.log(`Rate limited. Retry after: ${retryAfterSeconds} seconds`);',
        '      // Implement your own retry logic',
        '      setTimeout(() => {',
        '        // Retry the request',
        '      }, retryAfterSeconds * 1000);',
        '    }',
        '  }',
        '}',
      ]),
    );

    return sections.join('\n');
  }

  authenticationDocs(): string {
    const authOptions = this.#authentication();

    if (isEmpty(authOptions)) {
      return '';
    }

    const only = authOptions.length === 1;
    const sections: string[] = [
      '## Authentication',
      '',
      only
        ? 'The SDK requires authentication to access the API. Configure your client with the required credentials:'
        : 'The SDK supports the following authentication methods:',
      '',
    ];

    for (const { name, scheme } of authOptions) {
      sections.push(`### ${authenticationHeading(name, scheme, only)}`);
      sections.push('');
      if (isBearer(scheme)) {
        sections.push(
          'Pass your bearer token directly - the "Bearer" prefix is automatically added:',
        );
        sections.push('');
      }
      const client = this.#constructClient({
        credentials: { [name]: this.#credentialExample(scheme) },
      });
      sections.push(createCodeBlock('typescript', [client.use]));
      sections.push('');
    }

    return sections.join('\n');
  }

  generalUsageDocs(): string {
    const sections: string[] = [];

    return sections.join('\n');
  }

  configurationUpdateDocs(): string {
    const sections: string[] = [];
    const authOptions = this.#authentication();

    sections.push('### Updating Configuration');
    sections.push('');
    sections.push(
      'You can update client configuration after initialization using the `setOptions` method:',
    );
    sections.push('');

    const initialClientOptions: Record<string, unknown> = {
      baseUrl: 'https://api.production-service.com',
    };

    if (!isEmpty(authOptions)) {
      const [primaryAuth] = authOptions;
      initialClientOptions.credentials = {
        [primaryAuth.name]: this.#credentialExample(primaryAuth.scheme),
      };
    }

    const initialClientSetup = this.#constructClient(initialClientOptions);

    const configurationUpdateCode = [
      '// Initial client setup',
      initialClientSetup.use,
      '',
      '// Later, update specific options',
      'client.setOptions({',
      "  baseUrl: 'https://api.staging-service.com',",
    ];

    if (!isEmpty(authOptions)) {
      const [primaryAuth] = authOptions;
      configurationUpdateCode.push(
        `  credentials: ${JSON.stringify({
          [primaryAuth.name]: this.#credentialExample(primaryAuth.scheme),
        })}`,
      );
    }

    configurationUpdateCode.push('});');

    sections.push(createCodeBlock('typescript', configurationUpdateCode));
    sections.push('');
    sections.push(
      'The `setOptions` method validates the provided options and only updates the specified fields, leaving other configuration unchanged.',
    );

    return sections.join('\n');
  }
}

function isBearer(scheme: OpenAPISecuritySchemeObject) {
  return scheme.type === 'http' && scheme.scheme?.toLowerCase() === 'bearer';
}

function authenticationHeading(
  name: string,
  scheme: OpenAPISecuritySchemeObject,
  only: boolean,
) {
  if (isBearer(scheme)) {
    return only ? 'Bearer Token' : 'Bearer Token Authentication';
  }
  if (scheme.type === 'apiKey' && scheme.in === 'header') {
    return only ? 'API Key (Header)' : 'API Key Authentication (Header)';
  }
  if (scheme.type === 'apiKey' && scheme.in === 'query') {
    return only
      ? 'API Key (Query Parameter)'
      : 'API Key Authentication (Query Parameter)';
  }
  return only ? name : `${name} Authentication`;
}

function createCodeBlock(language: string, content: string[]) {
  return ['```' + language, ...content, '```'].join('\n');
}

function createObjectLiteral(
  obj: Record<string, unknown>,
  indent = '\t',
): string {
  return (
    '{\n' +
    Object.entries(obj)
      .map(([key, value]) => `${indent}${key}: ${JSON.stringify(value)}`)
      .join(',\n') +
    `\n${indent.slice(0, -1)}}`
  );
}

function availablePaginationTypes(spec: IR) {
  let offset = false;
  let page = false;
  let cursor = false;
  forEachOperation(spec, (entry, operation) => {
    if (operation['x-pagination']) {
      switch (operation['x-pagination'].type) {
        case 'offset':
          offset = true;
          break;
        case 'page':
          page = true;
          break;
        case 'cursor':
          cursor = true;
          break;
      }
    }
  });
  return {
    offset,
    page,
    cursor,
  };
}
