import type {
  OpenAPIObject,
  ReferenceObject,
  SchemaObject,
} from 'openapi3-ts/oas31';

import { followRef, isRef } from '@sdk-it/core';

/**
 * Generate example values for OpenAPI schemas
 * This emitter creates sample input payloads for API documentation and code snippets
 */
export class SnippetEmitter {
  private spec: OpenAPIObject;
  public generatedRefs = new Set<string>();
  private cache = new Map<string, unknown>();

  constructor(spec: OpenAPIObject) {
    this.spec = spec;
  }

  public object(
    schema: SchemaObject | ReferenceObject,
  ): Record<string, unknown> {
    const schemaObj = isRef(schema)
      ? followRef<SchemaObject>(this.spec, schema.$ref)
      : schema;
    const result: Record<string, unknown> = {};
    const properties = schemaObj.properties || {};

    for (const [propName, propSchema] of Object.entries(properties)) {
      const isRequired = (schemaObj.required ?? []).includes(propName);
      const resolvedProp = isRef(propSchema)
        ? followRef<SchemaObject>(this.spec, propSchema.$ref)
        : propSchema;

      if (
        isRequired ||
        resolvedProp.example !== undefined ||
        resolvedProp.default !== undefined ||
        Math.random() > 0.5
      ) {
        result[propName] = this.handle(propSchema);
      }
    }

    if (
      schemaObj.additionalProperties &&
      typeof schemaObj.additionalProperties === 'object'
    ) {
      result['additionalPropExample'] = this.handle(
        schemaObj.additionalProperties,
      );
    }

    return result;
  }

  public array(schema: SchemaObject | ReferenceObject): unknown[] {
    const schemaObj = isRef(schema)
      ? followRef<SchemaObject>(this.spec, schema.$ref)
      : schema;
    const itemsSchema = schemaObj.items;
    if (!itemsSchema) {
      return [];
    }

    const count = Math.min(schemaObj.minItems ?? 1, 2);
    const result: unknown[] = [];

    for (let i = 0; i < count; i++) {
      result.push(this.handle(itemsSchema));
    }

    return result;
  }

  public string(schema: SchemaObject): string {
    if (schema.example !== undefined) return String(schema.example);
    if (schema.default !== undefined) return String(schema.default);

    switch (schema.format) {
      case 'date-time':
      case 'datetime':
        return new Date().toISOString();
      case 'date':
        return new Date().toISOString().split('T')[0];
      case 'time':
        return new Date().toISOString().split('T')[1];
      case 'email':
        return 'user@example.com';
      case 'uuid':
        return '123e4567-e89b-12d3-a456-426614174000';
      case 'uri':
      case 'url':
        return 'https://example.com';
      case 'ipv4':
        return '192.168.1.1';
      case 'ipv6':
        return '2001:0db8:85a3:0000:0000:8a2e:0370:7334';
      case 'hostname':
        return 'example.com';
      case 'binary':
      case 'byte':
        return `new Blob(['example'], { type: 'text/plain' })`;
      default:
        if (schema.enum && schema.enum.length > 0) {
          return String(schema.enum[0]);
        }
        return schema.pattern ? `string matching ${schema.pattern}` : 'example';
    }
  }

  public number(schema: SchemaObject): number {
    if (schema.example !== undefined) return Number(schema.example);
    if (schema.default !== undefined) return Number(schema.default);

    let value: number;
    if (typeof schema.exclusiveMinimum === 'number') {
      value = schema.exclusiveMinimum + 1;
    } else if (typeof schema.minimum === 'number') {
      value = schema.minimum;
    } else {
      value = schema.type === 'integer' ? 42 : 42.42;
    }

    if (
      typeof schema.exclusiveMaximum === 'number' &&
      value >= schema.exclusiveMaximum
    ) {
      value = schema.exclusiveMaximum - 1;
    } else if (typeof schema.maximum === 'number' && value > schema.maximum) {
      value = schema.maximum;
    }

    if (
      typeof schema.multipleOf === 'number' &&
      value % schema.multipleOf !== 0
    ) {
      value = Math.floor(value / schema.multipleOf) * schema.multipleOf;
    }

    return schema.type === 'integer' ? Math.floor(value) : value;
  }

  public boolean(schema: SchemaObject): boolean {
    if (schema.example !== undefined) return Boolean(schema.example);
    if (schema.default !== undefined) return Boolean(schema.default);
    return true;
  }

  public null(): null {
    return null;
  }

  public ref($ref: string): unknown {
    const parts = $ref.split('/');
    const refKey = parts[parts.length - 1] || '';

    if (this.cache.has($ref)) {
      return this.cache.get($ref) as unknown;
    }

    this.cache.set($ref, { _ref: refKey });

    const resolved = followRef<SchemaObject>(this.spec, $ref);
    const result = this.handle(resolved);

    this.cache.set($ref, result);
    return result;
  }

  public allOf(schemas: (SchemaObject | ReferenceObject)[]): unknown {
    const initial: Record<string, unknown> = {};
    return schemas.reduce<Record<string, unknown>>((result, schema) => {
      const example = this.handle(schema);
      if (typeof example === 'object' && example !== null) {
        return { ...result, ...example };
      }
      return result;
    }, initial);
  }

  public anyOf(schemas: (SchemaObject | ReferenceObject)[]): unknown {
    if (schemas.length === 0) return {};
    return this.handle(schemas[0]);
  }

  public oneOf(schemas: (SchemaObject | ReferenceObject)[]): unknown {
    if (schemas.length === 0) return {};
    return this.handle(schemas[0]);
  }

  public enum(schema: SchemaObject): unknown {
    return Array.isArray(schema.enum) && schema.enum.length > 0
      ? schema.enum[0]
      : undefined;
  }

  public handle(schemaOrRef: SchemaObject | ReferenceObject): unknown {
    if (isRef(schemaOrRef)) {
      return this.ref(schemaOrRef.$ref);
    }

    const schema = isRef(schemaOrRef)
      ? followRef<SchemaObject>(this.spec, schemaOrRef.$ref)
      : schemaOrRef;

    if (schema.example !== undefined) {
      return schema.example;
    }
    if (schema.default !== undefined) {
      return schema.default;
    }

    if (schema.allOf && Array.isArray(schema.allOf)) {
      return this.allOf(schema.allOf);
    }
    if (schema.anyOf && Array.isArray(schema.anyOf)) {
      return this.anyOf(schema.anyOf);
    }
    if (schema.oneOf && Array.isArray(schema.oneOf)) {
      return this.oneOf(schema.oneOf);
    }

    if (schema.enum && Array.isArray(schema.enum) && schema.enum.length > 0) {
      return this.enum(schema);
    }

    const types = Array.isArray(schema.type)
      ? schema.type
      : schema.type
        ? [schema.type]
        : [];

    if (types.length === 0) {
      if (schema.properties || schema.additionalProperties) {
        return this.object(schema);
      } else if (schema.items) {
        return this.array(schema);
      }
      return 'example';
    }

    const primaryType = types.find((t) => t !== 'null') || types[0];

    switch (primaryType) {
      case 'string':
        return this.string(schema);
      case 'number':
      case 'integer':
        return this.number(schema);
      case 'boolean':
        return this.boolean(schema);
      case 'object':
        return this.object(schema);
      case 'array':
        return this.array(schema);
      case 'null':
        return this.null();
      default:
        return 'unknown';
    }
  }

  public paginationDocs(): string {
    // Check if any operations have pagination
    const hasPagination = this.spec.paths && Object.values(this.spec.paths).some(pathItem => 
      Object.values(pathItem || {}).some(operation => 
        typeof operation === 'object' && operation !== null && 'x-pagination' in operation
      )
    );

    if (!hasPagination) {
      return '';
    }

    const sections: string[] = [];
    
    sections.push('## Pagination');
    sections.push('');
    sections.push('This SDK automatically handles pagination for endpoints that return multiple items.');
    sections.push('');
    
    sections.push('### How it Works');
    sections.push('');
    sections.push('When you call a paginated endpoint, the SDK returns a pagination object that allows you to iterate through all results:');
    sections.push('');
    sections.push('```typescript');
    sections.push('// The SDK automatically handles pagination');
    sections.push('const pagination = await client.items.list({');
    sections.push('  limit: 20');
    sections.push('});');
    sections.push('');
    sections.push('// Access the current page data');
    sections.push('const currentPage = pagination.getCurrentPage();');
    sections.push('console.log(currentPage.data); // Array of items');
    sections.push('');
    sections.push('// Check if more pages exist');
    sections.push('if (pagination.hasMore) {');
    sections.push('  await pagination.getNextPage();');
    sections.push('}');
    sections.push('```');
    sections.push('');
    
    sections.push('### Iterating Through All Pages');
    sections.push('');
    sections.push('```typescript');
    sections.push('// Using async iteration');
    sections.push('const pagination = await client.items.list({ limit: 100 });');
    sections.push('');
    sections.push('for await (const page of pagination) {');
    sections.push('  // Process each page');
    sections.push('  console.log(`Processing ${page.data.length} items`);');
    sections.push('  ');
    sections.push('  for (const item of page.data) {');
    sections.push('    // Process individual items');
    sections.push('    console.log(item);');
    sections.push('  }');
    sections.push('}');
    sections.push('```');
    sections.push('');
    
    sections.push('### Pagination Types');
    sections.push('');
    sections.push('The SDK supports three pagination strategies, automatically detected from your API:');
    sections.push('');
    sections.push('1. **Cursor Pagination** - Uses a cursor token to fetch the next page');
    sections.push('2. **Offset Pagination** - Uses offset and limit parameters');
    sections.push('3. **Page Pagination** - Uses page number and page size');
    sections.push('');
    sections.push('The SDK handles the differences transparently, providing a consistent interface regardless of the underlying pagination type.');
    
    return sections.join('\n');
  }

  public clientSetupDocs(): string {
    const sections: string[] = [];
    const hasServers = this.spec.servers && this.spec.servers.length > 0;
    const baseUrl = this.spec.servers?.[0]?.url || 'https://api.example.com';
    
    // Check for authentication options
    const securitySchemes = this.spec.components?.securitySchemes || {};
    const hasApiKey = Object.values(securitySchemes).some(scheme => 
      scheme.type === 'apiKey' || (scheme.type === 'http' && scheme.scheme === 'bearer')
    );
    
    sections.push('## Client Setup');
    sections.push('');
    sections.push('### Installation');
    sections.push('');
    sections.push('```bash');
    sections.push('npm install @your-org/sdk');
    sections.push('# or');
    sections.push('yarn add @your-org/sdk');
    sections.push('# or');
    sections.push('pnpm add @your-org/sdk');
    sections.push('```');
    sections.push('');
    
    sections.push('### Basic Usage');
    sections.push('');
    sections.push('```typescript');
    sections.push('import { Client } from "@your-org/sdk";');
    sections.push('');
    sections.push('const client = new Client({');
    if (hasServers) {
      sections.push(`  baseUrl: "${baseUrl}",`);
    }
    if (hasApiKey) {
      sections.push('  apiKey: "your-api-key",');
    }
    sections.push('  fetch: globalThis.fetch, // Required: provide fetch implementation');
    sections.push('});');
    sections.push('```');
    sections.push('');
    
    sections.push('### Configuration Options');
    sections.push('');
    sections.push('| Option | Type | Required | Description |');
    sections.push('|--------|------|----------|-------------|');
    sections.push('| `fetch` | `typeof fetch` | Yes | Fetch implementation to use for HTTP requests |');
    if (hasServers) {
      sections.push('| `baseUrl` | `string` | No | API base URL (default: `' + baseUrl + '`) |');
    }
    
    // Add auth options based on security schemes
    for (const [name, scheme] of Object.entries(securitySchemes)) {
      if (scheme.type === 'apiKey') {
        sections.push(`| \`${name}\` | \`string\` | No | API key for authentication |`);
      } else if (scheme.type === 'http' && scheme.scheme === 'bearer') {
        sections.push(`| \`${name}\` | \`string\` | No | Bearer token for authentication |`);
      }
    }
    sections.push('');
    
    sections.push('### Making Requests');
    sections.push('');
    sections.push('```typescript');
    sections.push('// Using the generated methods (recommended)');
    sections.push('const users = await client.users.list({ limit: 10 });');
    sections.push('');
    sections.push('// Using the generic request method');
    sections.push('const result = await client.request("GET /users", {');
    sections.push('  limit: 10');
    sections.push('});');
    sections.push('```');
    sections.push('');
    
    sections.push('### Request Options');
    sections.push('');
    sections.push('You can pass additional options to any request:');
    sections.push('');
    sections.push('```typescript');
    sections.push('const users = await client.users.list(');
    sections.push('  { limit: 10 },');
    sections.push('  {');
    sections.push('    signal: abortController.signal, // AbortSignal for cancellation');
    sections.push('    headers: {');
    sections.push('      "X-Request-ID": "custom-id" // Additional headers');
    sections.push('    }');
    sections.push('  }');
    sections.push(');');
    sections.push('```');
    sections.push('');
    
    sections.push('### TypeScript Support');
    sections.push('');
    sections.push('The SDK is fully typed and provides TypeScript definitions for all endpoints:');
    sections.push('');
    sections.push('```typescript');
    sections.push('import type { Client } from "@your-org/sdk";');
    sections.push('');
    sections.push('// All parameters and responses are fully typed');
    sections.push('const response = await client.users.create({');
    sections.push('  name: "John Doe", // TypeScript will enforce required fields');
    sections.push('  email: "john@example.com"');
    sections.push('});');
    sections.push('```');
    
    return sections.join('\n');
  }

  public streamingDocs(): string {
    // Check if any operations have streaming responses
    const hasStreaming = this.spec.paths && Object.values(this.spec.paths).some(pathItem => 
      Object.values(pathItem || {}).some(operation => {
        if (typeof operation !== 'object' || operation === null || !('responses' in operation)) {
          return false;
        }
        
        // Check for streaming responses
        return Object.values(operation.responses || {}).some(response => {
          if (typeof response !== 'object' || response === null) return false;
          
          // Check for Transfer-Encoding header (SSE)
          if (response.headers?.['Transfer-Encoding']) return true;
          
          // Check for streaming content types
          const content = response.content || {};
          return Object.keys(content).some(contentType => 
            contentType === 'application/octet-stream' || 
            contentType === 'text/event-stream'
          );
        });
      })
    );

    if (!hasStreaming) {
      return '';
    }

    const sections: string[] = [];
    
    sections.push('## Streaming');
    sections.push('');
    sections.push('The SDK supports streaming responses for real-time data and file downloads.');
    sections.push('');
    
    // Check specifically for SSE endpoints
    const hasSSE = this.spec.paths && Object.values(this.spec.paths).some(pathItem => 
      Object.values(pathItem || {}).some(operation => {
        if (typeof operation !== 'object' || operation === null || !('responses' in operation)) {
          return false;
        }
        return Object.values(operation.responses || {}).some(response => 
          typeof response === 'object' && response !== null && 
          (response.headers?.['Transfer-Encoding'] || response.content?.['text/event-stream'])
        );
      })
    );

    if (hasSSE) {
      sections.push('### Server-Sent Events (SSE)');
      sections.push('');
      sections.push('For endpoints that return streaming events, the SDK returns a `ReadableStream`:');
      sections.push('');
      sections.push('```typescript');
      sections.push('// Get a stream of events');
      sections.push('const stream = await client.events.stream();');
      sections.push('');
      sections.push('// Process the stream using a reader');
      sections.push('const reader = stream.getReader();');
      sections.push('const decoder = new TextDecoder();');
      sections.push('');
      sections.push('try {');
      sections.push('  while (true) {');
      sections.push('    const { done, value } = await reader.read();');
      sections.push('    if (done) break;');
      sections.push('    ');
      sections.push('    const text = decoder.decode(value, { stream: true });');
      sections.push('    console.log("Received:", text);');
      sections.push('  }');
      sections.push('} finally {');
      sections.push('  reader.releaseLock();');
      sections.push('}');
      sections.push('```');
      sections.push('');
    }
    
    sections.push('### Binary Streams');
    sections.push('');
    sections.push('For endpoints that return binary data (files, images, etc.), the SDK returns a `ReadableStream`:');
    sections.push('');
    sections.push('```typescript');
    sections.push('// Download a file as a stream');
    sections.push('const stream = await client.files.download({ id: "file-123" });');
    sections.push('');
    sections.push('// In Node.js, save to file');
    sections.push('import { Writable } from "stream";');
    sections.push('import { createWriteStream } from "fs";');
    sections.push('');
    sections.push('const fileStream = createWriteStream("./download.pdf");');
    sections.push('const reader = stream.getReader();');
    sections.push('');
    sections.push('try {');
    sections.push('  while (true) {');
    sections.push('    const { done, value } = await reader.read();');
    sections.push('    if (done) break;');
    sections.push('    fileStream.write(value);');
    sections.push('  }');
    sections.push('} finally {');
    sections.push('  fileStream.close();');
    sections.push('  reader.releaseLock();');
    sections.push('}');
    sections.push('```');
    sections.push('');
    
    sections.push('### Stream Cancellation');
    sections.push('');
    sections.push('Use an `AbortController` to cancel ongoing streams:');
    sections.push('');
    sections.push('```typescript');
    sections.push('const controller = new AbortController();');
    sections.push('');
    sections.push('// Start streaming with abort signal');
    sections.push('const stream = await client.events.stream(');
    sections.push('  {},');
    sections.push('  { signal: controller.signal }');
    sections.push(');');
    sections.push('');
    sections.push('// Cancel after 30 seconds');
    sections.push('setTimeout(() => controller.abort(), 30000);');
    sections.push('```');
    
    return sections.join('\n');
  }

  public errorHandlingDocs(): string {
    const sections: string[] = [];
    
    sections.push('## Error Handling');
    sections.push('');
    sections.push('The SDK provides comprehensive error handling with typed errors and automatic retries.');
    sections.push('');
    
    sections.push('### Error Types');
    sections.push('');
    sections.push('All SDK errors extend from `ApiError` and include detailed information:');
    sections.push('');
    sections.push('```typescript');
    sections.push('import { ApiError, ValidationError, AuthenticationError } from "@your-org/sdk";');
    sections.push('');
    sections.push('try {');
    sections.push('  const user = await client.users.create({');
    sections.push('    email: "invalid-email"');
    sections.push('  });');
    sections.push('} catch (error) {');
    sections.push('  if (error instanceof ValidationError) {');
    sections.push('    // Handle validation errors');
    sections.push('    console.error("Validation failed:", error.errors);');
    sections.push('    // error.errors = [{ field: "email", message: "Invalid email format" }]');
    sections.push('  } else if (error instanceof AuthenticationError) {');
    sections.push('    // Handle auth errors');
    sections.push('    console.error("Authentication failed:", error.message);');
    sections.push('  } else if (error instanceof ApiError) {');
    sections.push('    // Handle other API errors');
    sections.push('    console.error(`API Error ${error.status}:`, error.message);');
    sections.push('  } else {');
    sections.push('    // Handle unexpected errors');
    sections.push('    throw error;');
    sections.push('  }');
    sections.push('}');
    sections.push('```');
    sections.push('');
    
    sections.push('### Error Properties');
    sections.push('');
    sections.push('```typescript');
    sections.push('interface ApiError {');
    sections.push('  message: string;        // Human-readable error message');
    sections.push('  status: number;         // HTTP status code');
    sections.push('  code: string;           // API error code');
    sections.push('  requestId: string;      // Unique request identifier');
    sections.push('  timestamp: Date;        // When the error occurred');
    sections.push('  details?: any;          // Additional error details');
    sections.push('}');
    sections.push('```');
    sections.push('');
    
    sections.push('### Common Error Scenarios');
    sections.push('');
    sections.push('#### Rate Limiting');
    sections.push('```typescript');
    sections.push('import { RateLimitError } from "@your-org/sdk";');
    sections.push('');
    sections.push('try {');
    sections.push('  await client.users.list();');
    sections.push('} catch (error) {');
    sections.push('  if (error instanceof RateLimitError) {');
    sections.push('    const retryAfter = error.retryAfter; // Seconds to wait');
    sections.push('    console.log(`Rate limited. Retry after ${retryAfter} seconds`);');
    sections.push('    ');
    sections.push('    // Wait and retry');
    sections.push('    await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));');
    sections.push('    const result = await client.users.list();');
    sections.push('  }');
    sections.push('}');
    sections.push('```');
    sections.push('');
    
    sections.push('#### Network Errors');
    sections.push('```typescript');
    sections.push('import { NetworkError } from "@your-org/sdk";');
    sections.push('');
    sections.push('try {');
    sections.push('  await client.users.get({ id: "123" });');
    sections.push('} catch (error) {');
    sections.push('  if (error instanceof NetworkError) {');
    sections.push('    console.error("Network error:", error.message);');
    sections.push('    // Implement retry logic or fallback');
    sections.push('  }');
    sections.push('}');
    sections.push('```');
    sections.push('');
    
    sections.push('### Automatic Retries');
    sections.push('');
    sections.push('The SDK automatically retries failed requests with exponential backoff:');
    sections.push('');
    sections.push('```typescript');
    sections.push('const client = new Client({');
    sections.push('  maxRetries: 3, // Default: 3');
    sections.push('  retryDelay: 1000, // Initial delay in ms');
    sections.push('  retryCondition: (error) => {');
    sections.push('    // Custom retry logic');
    sections.push('    return error.status >= 500 || error.code === "NETWORK_ERROR";');
    sections.push('  }');
    sections.push('});');
    sections.push('```');
    sections.push('');
    
    sections.push('### Global Error Handler');
    sections.push('');
    sections.push('Set up a global error handler for all SDK operations:');
    sections.push('');
    sections.push('```typescript');
    sections.push('const client = new Client({');
    sections.push('  onError: (error, request) => {');
    sections.push('    // Log to error tracking service');
    sections.push('    console.error("SDK Error:", {');
    sections.push('      error: error.message,');
    sections.push('      status: error.status,');
    sections.push('      request: request.url,');
    sections.push('      requestId: error.requestId');
    sections.push('    });');
    sections.push('  }');
    sections.push('});');
    sections.push('```');
    sections.push('');
    
    sections.push('### Best Practices');
    sections.push('');
    sections.push('1. **Always handle specific error types** before generic ones');
    sections.push('2. **Log error details** including request IDs for debugging');
    sections.push('3. **Implement appropriate retry strategies** for transient errors');
    sections.push('4. **Provide user-friendly error messages** in your application');
    sections.push('5. **Monitor error rates** to detect issues early');
    
    return sections.join('\n');
  }

  public authenticationDocs(): string {
    const sections: string[] = [];
    
    sections.push('## Authentication');
    sections.push('');
    sections.push('The SDK supports multiple authentication methods to secure your API requests.');
    sections.push('');
    
    sections.push('### API Key Authentication');
    sections.push('');
    sections.push('The simplest authentication method using an API key:');
    sections.push('');
    sections.push('```typescript');
    sections.push('const client = new Client({');
    sections.push('  apiKey: process.env.API_KEY');
    sections.push('});');
    sections.push('');
    sections.push('// The SDK automatically includes the API key in all requests');
    sections.push('const users = await client.users.list();');
    sections.push('```');
    sections.push('');
    
    sections.push('### Bearer Token Authentication');
    sections.push('');
    sections.push('For OAuth 2.0 or JWT-based authentication:');
    sections.push('');
    sections.push('```typescript');
    sections.push('const client = new Client({');
    sections.push('  accessToken: "your-bearer-token"');
    sections.push('});');
    sections.push('');
    sections.push('// Or set it after initialization');
    sections.push('client.setAccessToken("new-bearer-token");');
    sections.push('```');
    sections.push('');
    
    sections.push('### OAuth 2.0 Flow');
    sections.push('');
    sections.push('Complete OAuth 2.0 authentication flow:');
    sections.push('');
    sections.push('```typescript');
    sections.push('// 1. Get authorization URL');
    sections.push('const authUrl = client.auth.getAuthorizationUrl({');
    sections.push('  clientId: process.env.CLIENT_ID,');
    sections.push('  redirectUri: "https://your-app.com/callback",');
    sections.push('  scope: ["read:users", "write:users"],');
    sections.push('  state: generateRandomState()');
    sections.push('});');
    sections.push('');
    sections.push('// 2. Redirect user to authUrl');
    sections.push('// 3. Handle callback and exchange code for token');
    sections.push('const tokenResponse = await client.auth.exchangeCode({');
    sections.push('  code: callbackCode,');
    sections.push('  clientId: process.env.CLIENT_ID,');
    sections.push('  clientSecret: process.env.CLIENT_SECRET,');
    sections.push('  redirectUri: "https://your-app.com/callback"');
    sections.push('});');
    sections.push('');
    sections.push('// 4. Use the access token');
    sections.push('client.setAccessToken(tokenResponse.accessToken);');
    sections.push('```');
    sections.push('');
    
    sections.push('### Token Refresh');
    sections.push('');
    sections.push('Automatically refresh expired tokens:');
    sections.push('');
    sections.push('```typescript');
    sections.push('const client = new Client({');
    sections.push('  accessToken: currentToken,');
    sections.push('  refreshToken: savedRefreshToken,');
    sections.push('  onTokenRefresh: async (newTokens) => {');
    sections.push('    // Save new tokens');
    sections.push('    await saveTokens(newTokens);');
    sections.push('    console.log("Tokens refreshed successfully");');
    sections.push('  }');
    sections.push('});');
    sections.push('');
    sections.push('// The SDK will automatically refresh tokens when they expire');
    sections.push('```');
    sections.push('');
    
    sections.push('### Custom Authentication');
    sections.push('');
    sections.push('Implement custom authentication logic:');
    sections.push('');
    sections.push('```typescript');
    sections.push('const client = new Client({');
    sections.push('  beforeRequest: async (request) => {');
    sections.push('    // Add custom authentication headers');
    sections.push('    const token = await getCustomToken();');
    sections.push('    request.headers["X-Custom-Auth"] = token;');
    sections.push('    request.headers["X-Auth-Timestamp"] = Date.now().toString();');
    sections.push('    return request;');
    sections.push('  }');
    sections.push('});');
    sections.push('```');
    sections.push('');
    
    sections.push('### Multiple Authentication Methods');
    sections.push('');
    sections.push('Use different authentication for different endpoints:');
    sections.push('');
    sections.push('```typescript');
    sections.push('// Default authentication');
    sections.push('const client = new Client({');
    sections.push('  apiKey: process.env.API_KEY');
    sections.push('});');
    sections.push('');
    sections.push('// Override for specific request');
    sections.push('const adminData = await client.admin.getData({');
    sections.push('  auth: {');
    sections.push('    bearer: process.env.ADMIN_TOKEN');
    sections.push('  }');
    sections.push('});');
    sections.push('```');
    sections.push('');
    
    sections.push('### Security Best Practices');
    sections.push('');
    sections.push('1. **Never hardcode credentials** - Use environment variables');
    sections.push('2. **Rotate API keys regularly** - Implement key rotation policies');
    sections.push('3. **Use HTTPS only** - Ensure all API calls use encrypted connections');
    sections.push('4. **Implement token refresh** - Avoid using long-lived access tokens');
    sections.push('5. **Secure token storage** - Store tokens securely, never in plain text');
    sections.push('6. **Validate SSL certificates** - Don\'t disable SSL verification in production');
    
    return sections.join('\n');
  }

  public generalUsageDocs(): string {
    const sections: string[] = [];
    
    sections.push('## Advanced Usage');
    sections.push('');
    sections.push('This section covers advanced features and patterns for getting the most out of the SDK.');
    sections.push('');
    
    sections.push('### Request & Response Interceptors');
    sections.push('');
    sections.push('Modify requests before sending and responses after receiving:');
    sections.push('');
    sections.push('```typescript');
    sections.push('const client = new Client({');
    sections.push('  beforeRequest: async (request) => {');
    sections.push('    // Add request ID for tracking');
    sections.push('    request.headers["X-Request-ID"] = generateUUID();');
    sections.push('    ');
    sections.push('    // Log outgoing requests');
    sections.push('    console.log(`[${request.method}] ${request.url}`);');
    sections.push('    ');
    sections.push('    return request;');
    sections.push('  },');
    sections.push('  ');
    sections.push('  afterResponse: async (response, request) => {');
    sections.push('    // Log response times');
    sections.push('    console.log(`Response received in ${response.elapsed}ms`);');
    sections.push('    ');
    sections.push('    // Add custom processing');
    sections.push('    if (response.headers["x-rate-limit-remaining"]) {');
    sections.push('      console.log(`Rate limit remaining: ${response.headers["x-rate-limit-remaining"]}`);');
    sections.push('    }');
    sections.push('    ');
    sections.push('    return response;');
    sections.push('  }');
    sections.push('});');
    sections.push('```');
    sections.push('');
    
    sections.push('### Timeout Configuration');
    sections.push('');
    sections.push('Configure timeouts at multiple levels:');
    sections.push('');
    sections.push('```typescript');
    sections.push('// Global timeout');
    sections.push('const client = new Client({');
    sections.push('  timeout: 30000 // 30 seconds for all requests');
    sections.push('});');
    sections.push('');
    sections.push('// Per-request timeout');
    sections.push('const quickResponse = await client.users.get({');
    sections.push('  id: "123",');
    sections.push('  requestOptions: {');
    sections.push('    timeout: 5000 // 5 seconds for this request only');
    sections.push('  }');
    sections.push('});');
    sections.push('');
    sections.push('// Timeout with custom handling');
    sections.push('try {');
    sections.push('  const data = await client.reports.generate({');
    sections.push('    type: "annual",');
    sections.push('    requestOptions: { timeout: 120000 } // 2 minutes');
    sections.push('  });');
    sections.push('} catch (error) {');
    sections.push('  if (error.code === "TIMEOUT") {');
    sections.push('    console.log("Report generation timed out");');
    sections.push('  }');
    sections.push('}');
    sections.push('```');
    sections.push('');
    
    sections.push('### Batch Requests');
    sections.push('');
    sections.push('Send multiple requests efficiently:');
    sections.push('');
    sections.push('```typescript');
    sections.push('// Parallel requests');
    sections.push('const [users, projects, tasks] = await Promise.all([');
    sections.push('  client.users.list({ limit: 100 }),');
    sections.push('  client.projects.list({ status: "active" }),');
    sections.push('  client.tasks.list({ assignee: "me" })');
    sections.push(']);');
    sections.push('');
    sections.push('// Batch API (if supported)');
    sections.push('const batchResponse = await client.batch.execute([');
    sections.push('  { method: "GET", url: "/users/123" },');
    sections.push('  { method: "GET", url: "/users/456" },');
    sections.push('  { method: "POST", url: "/tasks", body: { title: "New task" } }');
    sections.push(']);');
    sections.push('```');
    sections.push('');
    
    sections.push('### Webhook Handling');
    sections.push('');
    sections.push('Validate and process webhooks securely:');
    sections.push('');
    sections.push('```typescript');
    sections.push('import { verifyWebhookSignature } from "@your-org/sdk";');
    sections.push('');
    sections.push('// Express.js example');
    sections.push('app.post("/webhooks", express.raw({ type: "application/json" }), (req, res) => {');
    sections.push('  const signature = req.headers["x-webhook-signature"];');
    sections.push('  const timestamp = req.headers["x-webhook-timestamp"];');
    sections.push('  ');
    sections.push('  try {');
    sections.push('    // Verify the webhook signature');
    sections.push('    const isValid = verifyWebhookSignature({');
    sections.push('      payload: req.body,');
    sections.push('      signature,');
    sections.push('      timestamp,');
    sections.push('      secret: process.env.WEBHOOK_SECRET');
    sections.push('    });');
    sections.push('    ');
    sections.push('    if (!isValid) {');
    sections.push('      return res.status(401).send("Invalid signature");');
    sections.push('    }');
    sections.push('    ');
    sections.push('    // Process the webhook');
    sections.push('    const event = JSON.parse(req.body);');
    sections.push('    await processWebhookEvent(event);');
    sections.push('    ');
    sections.push('    res.status(200).send("OK");');
    sections.push('  } catch (error) {');
    sections.push('    console.error("Webhook error:", error);');
    sections.push('    res.status(500).send("Internal error");');
    sections.push('  }');
    sections.push('});');
    sections.push('```');
    sections.push('');
    
    sections.push('### Custom Transports');
    sections.push('');
    sections.push('Use custom HTTP clients or transports:');
    sections.push('');
    sections.push('```typescript');
    sections.push('import axios from "axios";');
    sections.push('');
    sections.push('const client = new Client({');
    sections.push('  httpClient: {');
    sections.push('    async request(config) {');
    sections.push('      // Use axios instead of fetch');
    sections.push('      const response = await axios(config);');
    sections.push('      return {');
    sections.push('        status: response.status,');
    sections.push('        headers: response.headers,');
    sections.push('        data: response.data');
    sections.push('      };');
    sections.push('    }');
    sections.push('  }');
    sections.push('});');
    sections.push('```');
    sections.push('');
    
    sections.push('### Logging & Debugging');
    sections.push('');
    sections.push('Enable detailed logging for debugging:');
    sections.push('');
    sections.push('```typescript');
    sections.push('const client = new Client({');
    sections.push('  debug: true, // Enable debug mode');
    sections.push('  logger: {');
    sections.push('    log: (level, message, data) => {');
    sections.push('      // Custom logging implementation');
    sections.push('      console.log(`[${level}] ${message}`, data);');
    sections.push('    }');
    sections.push('  }');
    sections.push('});');
    sections.push('');
    sections.push('// Or use environment variable');
    sections.push('// DEBUG=sdk:* node your-app.js');
    sections.push('```');
    sections.push('');
    
    sections.push('### Performance Tips');
    sections.push('');
    sections.push('1. **Connection Pooling**: Reuse client instances instead of creating new ones');
    sections.push('2. **Request Deduplication**: Cache identical requests made within a short time window');
    sections.push('3. **Compression**: Enable gzip compression for large payloads');
    sections.push('4. **Field Selection**: Request only the fields you need to reduce payload size');
    sections.push('5. **Concurrent Requests**: Use Promise.all() for independent requests');
    
    return sections.join('\n');
  }
}
