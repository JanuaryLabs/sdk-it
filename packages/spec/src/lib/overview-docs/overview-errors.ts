import type { ReferenceObject, SchemaObject } from 'openapi3-ts/oas31';

import { resolveRef } from '@sdk-it/core';

import { forEachOperation } from '../for-each-operation.js';
import { isErrorStatusCode } from '../is.js';
import type { NavItem } from '../sidebar.js';
import type { OurOpenAPIObject } from '../types.js';

interface ErrorSchema {
  statusCode: string;
  title: string;
  description?: string;
  schema: SchemaObject | ReferenceObject;
  operations: string[]; // Track which operations use this error
}

function resolveSchema(
  spec: OurOpenAPIObject,
  schema: SchemaObject | ReferenceObject,
): SchemaObject {
  return resolveRef<SchemaObject>(spec, schema);
}

function formatSchemaForDisplay(
  spec: OurOpenAPIObject,
  schema: SchemaObject | ReferenceObject,
): string {
  const resolvedSchema = resolveSchema(spec, schema);

  return `\`\`\`json
${JSON.stringify(resolvedSchema, null, 2)}
\`\`\``;
}

function getStatusDescription(statusCode: string): string {
  const descriptions: Record<string, string> = {
    '400': 'Bad Request - The request was invalid or cannot be served.',
    '401':
      'Unauthorized - Authentication is required and has failed or has not been provided.',
    '402': 'Payment Required - Payment is required to access this resource.',
    '403':
      'Forbidden - The request was valid, but the server is refusing action.',
    '404': 'Not Found - The requested resource could not be found.',
    '405':
      'Method Not Allowed - The request method is not supported for this resource.',
    '406':
      'Not Acceptable - The requested resource cannot generate content acceptable to the client.',
    '407':
      'Proxy Authentication Required - Authentication with the proxy is required.',
    '408': 'Request Timeout - The server timed out waiting for the request.',
    '409': 'Conflict - The request could not be completed due to a conflict.',
    '410': 'Gone - The requested resource is no longer available.',
    '411':
      'Length Required - The request did not specify the length of its content.',
    '412':
      'Precondition Failed - The server does not meet one of the preconditions.',
    '413':
      'Payload Too Large - The request is larger than the server is willing to process.',
    '414':
      'URI Too Long - The URI provided was too long for the server to process.',
    '415':
      'Unsupported Media Type - The request entity has a media type which the server does not support.',
    '416':
      'Range Not Satisfiable - The client has asked for a portion of the file that the server cannot supply.',
    '417':
      'Expectation Failed - The server cannot meet the requirements of the Expect request-header field.',
    '418':
      "I'm a teapot - The server refuses the attempt to brew coffee with a teapot.",
    '421':
      'Misdirected Request - The request was directed at a server that is not able to produce a response.',
    '422':
      'Unprocessable Entity - The request was well-formed but contains semantic errors.',
    '423': 'Locked - The resource that is being accessed is locked.',
    '424':
      'Failed Dependency - The request failed due to failure of a previous request.',
    '425':
      'Too Early - The server is unwilling to risk processing a request that might be replayed.',
    '426':
      'Upgrade Required - The client should switch to a different protocol.',
    '428':
      'Precondition Required - The origin server requires the request to be conditional.',
    '429':
      'Too Many Requests - The user has sent too many requests in a given amount of time.',
    '431':
      'Request Header Fields Too Large - The server is unwilling to process the request because header fields are too large.',
    '451':
      'Unavailable For Legal Reasons - The server is denying access to the resource for legal reasons.',
    '500':
      'Internal Server Error - The server encountered an unexpected condition.',
    '501':
      'Not Implemented - The server does not support the functionality required to fulfill the request.',
    '502':
      'Bad Gateway - The server received an invalid response from the upstream server.',
    '503': 'Service Unavailable - The server is currently unavailable.',
    '504':
      'Gateway Timeout - The server did not receive a timely response from the upstream server.',
    '505':
      'HTTP Version Not Supported - The server does not support the HTTP protocol version used in the request.',
    '506':
      'Variant Also Negotiates - The server has an internal configuration error.',
    '507':
      'Insufficient Storage - The server is unable to store the representation needed to complete the request.',
    '508':
      'Loop Detected - The server detected an infinite loop while processing the request.',
    '510':
      'Not Extended - Further extensions to the request are required for the server to fulfill it.',
    '511':
      'Network Authentication Required - The client needs to authenticate to gain network access.',
  };
  return (
    descriptions[statusCode] ||
    'An error occurred while processing the request.'
  );
}

export function generateErrorsOverview(spec: OurOpenAPIObject): NavItem {
  const errorSchemas: Map<string, ErrorSchema> = new Map();
  const markdown: string[] = [];
  markdown.push(`# Error Handling`);
  markdown.push(
    `This API uses conventional HTTP response codes to indicate the success or failure of an API request.`,
  );
  markdown.push(`## Official API Clients`);
  markdown.push(
    `Vellum maintains official API clients for Python, Node/Typescript, and Go. We recommend using these clients to interact with all stable endpoints. You can find them here:`,
  );
  markdown.push(`## HTTP Status Codes`);

  // First, collect all error schemas from operations
  forEachOperation(spec, (entry, operation) => {
    if (operation.responses) {
      for (const [statusCode, response] of Object.entries(
        operation.responses,
      )) {
        if (isErrorStatusCode(statusCode)) {
          const content = response.content;
          if (content?.['application/json']?.schema) {
            const key = `${statusCode}`;
            const operationId = `${entry.method.toUpperCase()} ${entry.path}`;

            if (!errorSchemas.has(key)) {
              errorSchemas.set(key, {
                statusCode,
                title: response.description || `${statusCode} Error`,
                description: response.description,
                schema: content['application/json'].schema as
                  | SchemaObject
                  | ReferenceObject,
                operations: [operationId],
              });
            } else {
              // Add this operation to the existing error schema
              const existing = errorSchemas.get(key);
              if (existing && !existing.operations.includes(operationId)) {
                existing.operations.push(operationId);
              }
            }
          }
        }
      }
    }
  });

  // Then sort and generate documentation
  const errors = Array.from(errorSchemas.values()).sort(
    (a, b) => parseInt(a.statusCode) - parseInt(b.statusCode),
  );

  if (errors.length === 0) {
    markdown.push(
      `No error responses are documented in this API specification.`,
    );
  } else {
    for (const error of errors) {
      markdown.push(`### ${error.statusCode} - ${error.title}`);
      const description =
        error.description || getStatusDescription(error.statusCode);
      if (description) {
        markdown.push(description);
      }

      // Show which operations return this error
      if (error.operations.length > 0) {
        const operationsList = [`**Used by operations:**`];
        for (const operation of error.operations) {
          operationsList.push(`- \`${operation}\``);
        }
        markdown.push(operationsList.join('\n'));
      }

      if (error.schema) {
        markdown.push(`**Response Schema:**`);
        markdown.push(formatSchemaForDisplay(spec, error.schema));
      }
    }
  }

  return {
    id: 'errors',
    title: 'Errors',
    url: '/errors',
    description: 'Error handling and HTTP status codes',
    content: markdown.join('\n\n'),
  };
}
