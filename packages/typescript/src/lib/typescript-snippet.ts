import type { SchemaObject } from 'openapi3-ts/oas31';
import { camelcase } from 'stringcase';

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
  operationInputs,
} from '@sdk-it/spec';

import { SnippetEmitter } from './emitters/snippet.ts';
import { type TypeScriptGeneratorOptions, packageNameOf } from './options.ts';
import { expandServerUrls } from './server-urls.ts';

export class TypeScriptSnippet implements Generator {
  #spec: IR;
  #snippetEmitter: SnippetEmitter;
  #clientName: string;
  #packageName: string;
  constructor(spec: IR, settings: TypeScriptGeneratorOptions) {
    this.#spec = spec;
    this.#snippetEmitter = new SnippetEmitter(spec);
    this.#clientName = pascalcase(settings.name.trim());
    this.#packageName = packageNameOf(settings);
  }
  succinct(entry: OperationEntry, operation: TunedOperationObject) {
    const payload = this.#render(this.#example(operation));

    const success = Object.entries(operation.responses).find(([status]) =>
      status.startsWith('2'),
    )?.[1];
    if (success?.['x-body'] === 'stream') {
      return this.#stream(entry, payload);
    }
    if (operation['x-pagination']) {
      return this.#pagination(entry, payload);
    }
    return this.#normal(entry, payload);
  }

  /** An input the operation's preferred input schema accepts: its required fields, and the fields that declare an example or a default. */
  #example(operation: TunedOperationObject) {
    const [preferred] = operationInputs(this.#spec, operation);
    return this.#snippetEmitter.handle(preferred.schema);
  }

  /**
   * The operation's example input with its first required field set to a value
   * of a type the field does not accept, so the client refuses it with a
   * `ParseError`; undefined when no such value exists.
   */
  #invalidInput(operation: TunedOperationObject) {
    const [preferred] = operationInputs(this.#spec, operation);
    const [field] = preferred.schema.required ?? [];
    const property =
      field === undefined ? undefined : preferred.schema.properties?.[field];
    const example = this.#example(operation);
    if (property === undefined || !isRecord(example)) {
      return undefined;
    }
    const value = wrongTypeValue(
      resolveRef<SchemaObject>(this.#spec, property),
    );
    if (value === undefined) {
      return undefined;
    }
    const key = JSON.stringify(field);
    return this.#render({ ...example, [field]: value })
      .split('\n')
      .flatMap((line) =>
        line.startsWith(`  ${key}:`)
          ? [
              `  // @ts-expect-error ${key} does not accept ${JSON.stringify(value)}`,
              line,
            ]
          : [line],
      )
      .join('\n');
  }

  #render(example: unknown) {
    return JSON.stringify(
      example,
      (key, value) => {
        if (value?.startsWith && value.startsWith('new')) {
          return `__REPLACE_${Math.random().toString(36).substring(2, 11)}__${value}__REPLACE_END__`;
        }
        return value;
      },
      2,
    ).replace(/"__REPLACE_[^"]*__([^"]*?)__REPLACE_END__"/g, '$1');
  }

  #pagination(entry: OperationEntry, payload: string) {
    return {
      content: `const controller = new AbortController();\nconst result = await ${camelcase(this.#clientName)}.request('${endpointOf(entry)}', ${payload}, { signal: controller.signal });`,
      footer: `for await (const page of result.iterPages({ signal: controller.signal })) {\n\t\tconsole.log(page);\n}`,
    };
  }

  #normal(entry: OperationEntry, payload: string) {
    return {
      content: `const result = ${this.#toRequest(entry, payload)}`,
      footer: 'console.log(result);',
    };
  }

  #stream(entry: OperationEntry, payload: string) {
    return {
      content: `const stream = ${this.#toRequest(entry, payload)}`,
      footer: `for await (const chunk of stream) {\n\t\tconsole.log(chunk);\n}`,
    };
  }

  #toRequest(entry: OperationEntry, payload: string) {
    return `await ${camelcase(this.#clientName)}.request('${endpointOf(entry)}', ${payload});`;
  }

  snippet(
    entry: OperationEntry,
    operation: TunedOperationObject,
    config: { frame?: boolean } = {},
  ) {
    const payload = this.succinct(entry, operation);
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
    const client = this.#clientSetup();
    return client.use ? `${client.import}\n\n${client.use}` : client.import;
  }

  /** The client setup with `names` imported beside the client. */
  #clientWith(names: string[]) {
    const client = this.#clientSetup();
    return [
      `import { ${[client.name, ...names].join(', ')} } from '${this.#packageName}';`,
      ...(client.use ? ['', client.use] : []),
    ];
  }

  #clientSetup() {
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

    return this.#constructClient(options);
  }

  /** The default instance when the README needs no settings, else a client created with them. */
  #constructClient(options: Record<string, unknown>) {
    const instance = camelcase(this.#clientName);
    if (isEmpty(options)) {
      return {
        name: instance,
        import: `import { ${instance} } from '${this.#packageName}';`,
        use: '',
      };
    }
    return {
      name: `create${this.#clientName}`,
      import: `import { create${this.#clientName} } from '${this.#packageName}';`,
      use: `const ${instance} = create${this.#clientName}({\n\t\t${Object.entries(
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
    const paginated = this.#paginatedOperations();
    const [first] = paginated;
    if (!first) {
      return '';
    }
    const { entry, operation } = first;
    const payload = this.#render(this.#example(operation));
    const request = this.#pagination(entry, payload);
    const sections = [
      '## Pagination',
      '',
      'A paginated endpoint resolves to a page: the response body, plus `hasNextPage()`, `getNextPage()` and `iterPages()`. `for await` over the request or the page yields every item across pages:',
      '',
      createCodeBlock('typescript', [
        this.client(),
        '',
        request.content,
        'console.log(result); // the response body of the first page',
        '',
        'if (result.hasNextPage()) {',
        '  const next = await result.getNextPage({ signal: controller.signal });',
        '  console.log(next);',
        '}',
        '',
        '// Or iterate through every page, each fetch cancellable',
        request.footer,
      ]),
      '',
      '### Iterating Through All Items',
      '',
      createCodeBlock('typescript', [
        this.client(),
        '',
        `for await (const item of ${camelcase(this.#clientName)}.request('${endpointOf(entry)}', ${payload})) {`,
        '  console.log(item);',
        '}',
      ]),
      '',
      '### Pagination Strategies',
      '',
      ...paginated.map(
        ({ entry, pagination }) =>
          `- \`${endpointOf(entry)}\`: ${paginationStrategy(pagination)}`,
      ),
    ];
    return sections.join('\n');
  }

  /** The first paginated operation of each pagination type, in README order. */
  #paginatedOperations() {
    const paginated = new Map<
      OperationPagination['type'],
      {
        entry: OperationEntry;
        operation: TunedOperationObject;
        pagination: OperationPagination;
      }
    >();
    forEachOperation(this.#spec, (entry, operation) => {
      const pagination = operation['x-pagination'];
      if (pagination && !paginated.has(pagination.type)) {
        paginated.set(pagination.type, { entry, operation, pagination });
      }
    });
    return [...paginated.values()];
  }

  /** The operation the README lists first. */
  #firstOperation() {
    let first:
      { entry: OperationEntry; operation: TunedOperationObject } | undefined;
    forEachOperation(this.#spec, (entry, operation) => {
      first ??= { entry, operation };
    });
    return first;
  }

  errorHandlingDocs(): string {
    const sections: string[] = [];
    const first = this.#firstOperation();

    sections.push('## Error Handling');
    sections.push('');
    sections.push(
      'The SDK provides structured error handling with typed HTTP error responses.',
    );
    sections.push('');

    if (first) {
      const { entry, operation } = first;
      const payload = this.#render(this.#example(operation));
      sections.push('### Error Response Types');
      sections.push('');
      sections.push(
        'All API errors extend from `APIError` and include the HTTP status code, the response headers and the response body:',
      );
      sections.push('');
      sections.push(
        createCodeBlock('typescript', [
          ...this.#clientWith([
            'BadRequest',
            'Unauthorized',
            'NotFound',
            'TooManyRequests',
            'InternalServerError',
            'ParseError',
          ]),
          '',
          'try {',
          `  const result = ${this.#toRequest(entry, payload)}`,
          '  console.log(result);',
          '} catch (error) {',
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
          '    console.log("Retry after:", error.headers.get(\'Retry-After\'));',
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
    }

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

    if (!first) {
      return sections.join('\n');
    }
    const { entry, operation } = first;

    const invalidInput = this.#invalidInput(operation);
    if (invalidInput !== undefined) {
      sections.push('');
      sections.push('### Input Validation Errors');
      sections.push('');
      sections.push(
        'When request input fails validation against the API schema, a `ParseError` is thrown before the request is sent:',
      );
      sections.push('');
      sections.push(
        createCodeBlock('typescript', [
          ...this.#clientWith(['ParseError']),
          '',
          'try {',
          `  const result = ${this.#toRequest(entry, invalidInput)}`,
          '  console.log(result);',
          '} catch (error) {',
          '  if (error instanceof ParseError) {',
          '    for (const [fieldName, issues] of Object.entries(error.data.fieldErrors)) {',
          "      console.log(`${fieldName}: ${(issues ?? []).map((issue) => issue.message).join(', ')}`);",
          '    }',
          '    if (error.data.formErrors.length > 0) {',
          "      console.log(`Form errors: ${error.data.formErrors.map((issue) => issue.message).join(', ')}`);",
          '    }',
          '  }',
          '}',
        ]),
      );
      sections.push('');
      sections.push(
        "`ParseError` contains detailed validation information using Zod's flattened error format, providing specific field-level and form-level validation messages.",
      );
    }

    sections.push('');
    sections.push('### Rate Limiting');
    sections.push('');
    sections.push(
      'A `TooManyRequests` error carries the response headers, so a `Retry-After` header tells when to retry:',
    );
    sections.push('');
    sections.push(
      createCodeBlock('typescript', [
        ...this.#clientWith(['TooManyRequests']),
        '',
        'try {',
        `  const result = ${this.#toRequest(entry, this.#render(this.#example(operation)))}`,
        '  console.log(result);',
        '} catch (error) {',
        '  if (error instanceof TooManyRequests) {',
        "    console.log(`Rate limited. Retry after: ${error.headers.get('Retry-After')}`);",
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
      sections.push(
        createCodeBlock('typescript', [client.import, '', client.use]),
      );
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
      initialClientSetup.import,
      '',
      '// Initial client setup',
      initialClientSetup.use,
      '',
      '// Later, update specific options',
      `${camelcase(this.#clientName)}.setOptions({`,
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

function endpointOf(entry: OperationEntry) {
  return `${entry.method.toUpperCase()} ${entry.path}`;
}

function paginationStrategy(pagination: OperationPagination) {
  switch (pagination.type) {
    case 'offset':
      return `offset pagination, with the \`${pagination.offsetParamName}\` and \`${pagination.limitParamName}\` parameters.`;
    case 'page':
      return `page pagination, with the \`${pagination.pageNumberParamName}\` and \`${pagination.pageSizeParamName}\` parameters.`;
    case 'cursor':
      return `cursor pagination, with the \`${pagination.cursorParamName}\` and \`${pagination.limitParamName}\` parameters.`;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A value whose type `schema` does not accept; undefined when it accepts every candidate or names no type. */
function wrongTypeValue(schema: SchemaObject) {
  const types: string[] = Array.isArray(schema.type)
    ? schema.type
    : schema.type
      ? [schema.type]
      : [];
  if (
    types.length === 0 ||
    schema.format === 'binary' ||
    schema.format === 'byte' ||
    schema.contentEncoding === 'binary'
  ) {
    return undefined;
  }
  const candidates = [
    { value: 123, types: ['number', 'integer'] },
    { value: 'text', types: ['string'] },
    { value: true, types: ['boolean'] },
  ];
  return candidates.find((candidate) =>
    candidate.types.every((type) => !types.includes(type)),
  )?.value;
}
