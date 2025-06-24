import type { SchemaObject, SecuritySchemeObject } from 'openapi3-ts/oas31';

import { resolveRef } from '@sdk-it/core/ref.js';

import { forEachOperation } from './for-each-operation.js';
import { isErrorStatusCode } from './is.js';
import type { OurOpenAPIObject } from './types.js';

export interface DocPage {
  id: string;
  title: string;
  description?: string;
  /**
   * Markdown content
   */
  content: string;
}

interface ErrorSchema {
  statusCode: string;
  title: string;
  description?: string;
  schema: SchemaObject;
}

function generateIntroductionMarkdown(spec: OurOpenAPIObject): string {
  const info = spec.info;
  let markdown = '';

  if (info.title) {
    markdown += `# ${info.title}\n\n`;
  }

  if (info.description) {
    markdown += `${info.description}\n\n`;
  }

  if (info.version) {
    markdown += `**Version:** ${info.version}\n\n`;
  }

  if (info.contact) {
    markdown += `## Contact\n\n`;
    if (info.contact.name) {
      markdown += `**Name:** ${info.contact.name}\n\n`;
    }
    if (info.contact.email) {
      markdown += `**Email:** ${info.contact.email}\n\n`;
    }
    if (info.contact.url) {
      markdown += `**URL:** ${info.contact.url}\n\n`;
    }
  }

  if (info.license) {
    markdown += `## License\n\n`;
    if (info.license.name) {
      markdown += `**License:** ${info.license.name}`;
      if (info.license.url) {
        markdown += ` ([${info.license.url}](${info.license.url}))`;
      }
      markdown += `\n\n`;
    }
  }

  // Add SDK links
  markdown += `## Available SDKs\n\n`;
  const sdkLinks = [
    '/typescript-sdk',
    '/python-sdk',
    '/go-sdk',
    '/java-sdk',
    '/php-sdk',
    '/ruby-sdk',
    '/dart-sdk',
  ];

  for (const link of sdkLinks) {
    const sdkName = link.replace('/', '').replace('-sdk', '').toUpperCase();
    markdown += `- [${sdkName} SDK](${link})\n`;
  }

  return markdown;
}

function getStatusDescription(statusCode: string): string {
  const descriptions: Record<string, string> = {
    '400': 'Bad Request - The request was invalid or cannot be served.',
    '401':
      'Unauthorized - Authentication is required and has failed or has not been provided.',
    '403':
      'Forbidden - The request was valid, but the server is refusing action.',
    '404': 'Not Found - The requested resource could not be found.',
    '422':
      'Unprocessable Entity - The request was well-formed but contains semantic errors.',
    '429':
      'Too Many Requests - The user has sent too many requests in a given amount of time.',
    '500':
      'Internal Server Error - The server encountered an unexpected condition.',
    '502':
      'Bad Gateway - The server received an invalid response from the upstream server.',
    '503': 'Service Unavailable - The server is currently unavailable.',
  };
  return (
    descriptions[statusCode] ||
    'An error occurred while processing the request.'
  );
}

function generateErrorsMarkdown(
  errorSchemas: Map<string, ErrorSchema>,
): string {
  let markdown = `# Error Handling\n\n`;
  markdown += `This API uses conventional HTTP response codes to indicate the success or failure of an API request.\n\n`;
  markdown += `## HTTP Status Codes\n\n`;

  const errors = Array.from(errorSchemas.values()).sort(
    (a, b) => parseInt(a.statusCode) - parseInt(b.statusCode),
  );

  for (const error of errors) {
    markdown += `### ${error.statusCode} - ${error.title}\n\n`;
    const description =
      error.description || getStatusDescription(error.statusCode);
    if (description) {
      markdown += `${description}\n\n`;
    }
    if (error.schema) {
      markdown += `**Response Schema:**\n\n`;
      markdown += `\`\`\`json\n${JSON.stringify(
        error.schema,
        null,
        2,
      )}\n\`\`\`\n\n`;
    }
  }

  return markdown;
}

function getSecuritySchemeDescription(scheme: SecuritySchemeObject): string {
  switch (scheme.type.toLowerCase()) {
    case 'apikey':
      return `This API uses an API key for authentication. The key should be sent in the \`${scheme.in}\` named \`${scheme.name}\`.`;
    case 'http':
      if (scheme.scheme === 'bearer') {
        return `This API uses HTTP Bearer authentication. A token should be included in the Authorization header.`;
      }
      return `This API uses HTTP ${scheme.scheme} authentication.`;
    case 'oauth2': {
      const flows = Object.keys(scheme.flows || {});
      return `This API uses OAuth 2.0 for authentication with the following flow(s): ${flows.join(
        ', ',
      )}.`;
    }
    case 'openidconnect':
      return `This API uses OpenID Connect for authentication. The OpenID Connect URL is: ${scheme.openIdConnectUrl}`;
    default:
      return 'This API uses a custom authentication scheme.';
  }
}

function generateAuthorizationMarkdown(spec: OurOpenAPIObject): string {
  let markdown = `# Authorization\n\n`;

  const securitySchemes = spec.components?.securitySchemes || {};
  const globalSecurity = spec.security || [];

  if (Object.keys(securitySchemes).length > 0) {
    markdown += `This API uses the following authentication schemes:\n\n`;
    markdown += `## Security Schemes\n\n`;

    for (const [name, scheme] of Object.entries(securitySchemes)) {
      const schemeObj = resolveRef<SecuritySchemeObject>(spec, scheme);
      markdown += `### ${name}\n\n`;

      const description =
        schemeObj.description || getSecuritySchemeDescription(schemeObj);
      markdown += `${description}\n\n`;

      markdown += `**Type:** \`${schemeObj.type}\`\n\n`;

      if (schemeObj.type === 'http') {
        markdown += `**Scheme:** \`${schemeObj.scheme}\`\n\n`;
        if (schemeObj.bearerFormat) {
          markdown += `**Bearer Format:** \`${schemeObj.bearerFormat}\`\n\n`;
        }
      } else if (schemeObj.type === 'oauth2') {
        markdown += `**Flows:**\n\n`;
        markdown += `\`\`\`json\n${JSON.stringify(
          schemeObj.flows,
          null,
          2,
        )}\n\`\`\`\n\n`;
      }
    }
  }

  if (globalSecurity.length > 0) {
    markdown += `## Global Security Requirements\n\n`;
    markdown += `These security schemes are required for all operations.\n\n`;
    markdown += `\`\`\`json\n${JSON.stringify(
      globalSecurity,
      null,
      2,
    )}\n\`\`\`\n\n`;
  }

  return markdown;
}

export function extractOverviewDocs(spec: OurOpenAPIObject): DocPage[] {
  const docs: DocPage[] = [];

  const introduction: DocPage = {
    id: 'introduction',
    title: 'Introduction',
    description: 'API overview and getting started guide',
    content: generateIntroductionMarkdown(spec),
  };

  const errorSchemas = new Map<string, ErrorSchema>();

  forEachOperation(spec, (entry, operation) => {
    if (operation.responses) {
      for (const [statusCode, response] of Object.entries(
        operation.responses,
      )) {
        if (isErrorStatusCode(statusCode)) {
          const content = response.content;
          if (content?.['application/json']?.schema) {
            const key = `${statusCode}`;
            if (!errorSchemas.has(key)) {
              errorSchemas.set(key, {
                statusCode,
                title: response.description || `${statusCode} Error`,
                description: response.description,
                schema: content['application/json'].schema as SchemaObject,
              });
            }
          }
        }
      }
    }
  });

  const errors: DocPage = {
    id: 'errors',
    title: 'Errors',
    description: 'Error handling and HTTP status codes',
    content: generateErrorsMarkdown(errorSchemas),
  };

  // Extract authorization documentation
  const authorization: DocPage = {
    id: 'authorization',
    title: 'Authorization',
    description: 'Authentication methods and security schemes',
    content: generateAuthorizationMarkdown(spec),
  };

  docs.push(introduction, errors, authorization);
  return docs;
}
