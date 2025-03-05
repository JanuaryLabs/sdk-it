import type {
  ExampleObject,
  OpenAPIObject,
  OperationObject,
  ParameterObject,
  PathItemObject,
  ReferenceObject,
  RequestBodyObject,
  ResponseObject,
  SchemaObject,
  Server,
  ServerObject,
} from 'openapi3-ts/oas31';
import { pascalcase } from 'stringcase';

import { type Method } from '@sdk-it/core';

import { followRef } from './json-zod.ts';

/**
 * Generate README.md documentation directly from OpenAPI spec
 */
export function generateReadme(
  spec: OpenAPIObject,
  settings: { name: string },
): string {
  const title = spec.info?.title || 'API Client';
  const description =
    spec.info?.description || 'API client generated from OpenAPI specification';
  const version = spec.info?.version || '1.0.0';

  // Get server URLs if available
  const servers = spec.servers || [];
  const defaultServerUrl =
    servers.length > 0 ? servers[0].url : 'https://api.example.com';

  // Security scheme
  const securityScheme = extractSecurityScheme(spec);

  // Extract all operations and organize by tags
  const operationsByTag = extractOperationsByTag(spec);

  // Header section
  let markdown = `# ${title} SDK\n\n`;
  markdown += `${description}\n\n`;
  markdown += `Version: ${version}\n\n`;

  // Installation section
  markdown += `## Installation\n\n`;
  markdown += `\`\`\`bash\n`;
  markdown += `npm install ${title.toLowerCase().replace(/\s+/g, '-')}-sdk\n`;
  markdown += `\`\`\`\n\n`;

  // Getting started section
  markdown += `## Getting Started\n\n`;
  markdown += `\`\`\`typescript\n`;
  markdown += `import { ${settings.name} } from '${title.toLowerCase().replace(/\s+/g, '-')}-sdk';\n\n`;
  markdown += `// Initialize the client\n`;
  markdown += `const client = new ${settings.name}({\n`;
  markdown += `  baseUrl: '${defaultServerUrl}',\n`;

  // Add security if needed
  if (securityScheme) {
    markdown += `  token: 'your-auth-token', // Required for authenticated endpoints\n`;
  }

  markdown += `});\n\n`;
  markdown += `// Example request\n`;

  // Generate example using first available endpoint
  const firstTag = Object.keys(operationsByTag)[0];
  if (firstTag && operationsByTag[firstTag].length > 0) {
    const firstOp = operationsByTag[firstTag][0];
    const exampleParams = generateExampleParams(firstOp.operation, spec);

    markdown += `const [data, error] = await client.request('${firstOp.method.toUpperCase()} ${firstOp.path}', ${
      Object.keys(exampleParams).length > 0
        ? formatExample(exampleParams)
        : '{}\n'
    });\n\n`;
  } else {
    markdown += `const [data, error] = await client.request('GET /example', {});\n\n`;
  }

  markdown += `if (error) {\n`;
  markdown += `  console.error('Error:', error);\n`;
  markdown += `} else {\n`;
  markdown += `  console.log('Success:', data);\n`;
  markdown += `}\n`;
  markdown += `\`\`\`\n\n`;

  // API Reference section
  markdown += `## API Reference\n\n`;

  // Group operations by tag
  for (const [tagName, operations] of Object.entries(operationsByTag)) {
    markdown += `### ${pascalcase(tagName)}\n\n`;

    for (const opInfo of operations) {
      markdown += generateEndpointDocs(spec, opInfo);
    }
  }

  // Add servers section if available
  if (servers.length > 0) {
    markdown += generateServersSection(servers);
  }

  return markdown;
}

interface OperationInfo {
  path: string;
  method: Method;
  operation: OperationObject;
  errors: string[];
  inputs: Record<string, { source: string }>;
}

/**
 * Extract operations from spec and organize by tags
 */
function extractOperationsByTag(
  spec: OpenAPIObject,
): Record<string, OperationInfo[]> {
  const operationsByTag: Record<string, OperationInfo[]> = {};

  // Process all paths and their operations
  for (const [path, pathItem] of Object.entries(spec.paths || {})) {
    for (const [methodName, operation] of Object.entries(pathItem || {})) {
      // Skip non-operation properties like parameters, etc.
      if (
        ['parameters', 'servers', 'summary', 'description', '$ref'].includes(
          methodName,
        )
      ) {
        continue;
      }

      const method = methodName.toLowerCase() as Method;
      const opObject = operation as OperationObject;

      // Determine tags, defaulting to 'general' if none specified
      const tags = opObject.tags?.length ? opObject.tags : ['general'];

      // Extract error responses
      const errors = extractErrorResponses(opObject.responses || {});

      // Extract inputs (parameters)
      const inputs = extractInputs(opObject, spec);

      // Create operation info
      const opInfo: OperationInfo = {
        path,
        method,
        operation: opObject,
        errors,
        inputs,
      };

      // Add operation to each of its tags
      for (const tag of tags) {
        operationsByTag[tag] = operationsByTag[tag] || [];
        operationsByTag[tag].push(opInfo);
      }
    }
  }

  return operationsByTag;
}

/**
 * Extract error responses from operation responses
 */
function extractErrorResponses(
  responses: Record<string, ResponseObject | ReferenceObject>,
): string[] {
  const errorNames: string[] = [];
  const responseMap: Record<string, string> = {
    '400': 'BadRequest',
    '401': 'Unauthorized',
    '403': 'Forbidden',
    '404': 'NotFound',
    '405': 'MethodNotAllowed',
    '409': 'Conflict',
    '422': 'UnprocessableEntity',
    '429': 'TooManyRequests',
    '500': 'InternalServerError',
    '502': 'BadGateway',
    '503': 'ServiceUnavailable',
  };

  for (const [code, _] of Object.entries(responses)) {
    const statusCode = parseInt(code, 10);
    if (statusCode >= 400) {
      const errorName = responseMap[code] || `Error${code}`;
      errorNames.push(errorName);
    }
  }

  return errorNames.length ? errorNames : ['ServerError'];
}

/**
 * Extract input parameters from an operation
 */
function extractInputs(
  operation: OperationObject,
  spec: OpenAPIObject,
): Record<string, { source: string }> {
  const inputs: Record<string, { source: string }> = {};

  // Process path, query, header parameters
  for (const param of operation.parameters || []) {
    const parameter = isReferenceObject(param)
      ? (followRef(spec, param.$ref) as ParameterObject)
      : param;

    inputs[parameter.name] = { source: parameter.in };
  }

  // Process request body properties as inputs
  if (operation.requestBody) {
    const requestBody = isReferenceObject(operation.requestBody)
      ? (followRef(spec, operation.requestBody.$ref) as RequestBodyObject)
      : operation.requestBody;

    if (requestBody.content?.['application/json']?.schema) {
      const schema = requestBody.content['application/json'].schema;
      const schemaObj = isReferenceObject(schema)
        ? (followRef(spec, schema.$ref) as SchemaObject)
        : schema;

      if (schemaObj.properties) {
        for (const propName of Object.keys(schemaObj.properties)) {
          inputs[propName] = { source: 'body' };
        }
      }
    }
  }

  return inputs;
}

/**
 * Extract security scheme from OpenAPI spec
 */
function extractSecurityScheme(spec: OpenAPIObject) {
  if (spec.components?.securitySchemes?.bearerAuth) {
    const scheme = spec.components.securitySchemes.bearerAuth;
    if (
      typeof scheme === 'object' &&
      !('$ref' in scheme) &&
      scheme.type === 'http' &&
      scheme.scheme === 'bearer'
    ) {
      return {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: scheme.bearerFormat || 'JWT',
        },
      };
    }
  }
  return undefined;
}

/**
 * Generate documentation for a single endpoint
 */
function generateEndpointDocs(
  spec: OpenAPIObject,
  opInfo: OperationInfo,
): string {
  const { path, method, operation, errors, inputs } = opInfo;
  let markdown = `#### \`${method.toUpperCase()} ${path}\`\n\n`;

  if (operation.summary) {
    markdown += `**Summary:** ${operation.summary}\n\n`;
  }

  if (operation.description) {
    markdown += `**Description:** ${operation.description}\n\n`;
  }

  // Document request parameters
  if (Object.keys(inputs).length > 0) {
    markdown += `**Parameters:**\n\n`;
    markdown += `| Name | Source | Required | Description | Example |\n`;
    markdown += `| ---- | ------ | -------- | ----------- | ------- |\n`;

    for (const [name, input] of Object.entries(inputs)) {
      const param = findParameterByName(operation, name, spec);

      const description =
        param && 'description' in param ? param.description || '-' : '-';
      const required =
        param && 'required' in param ? (param.required ? 'Yes' : 'No') : 'No';

      // Get example from parameter, schema, or schema.example
      const example = extractExample(param, spec);
      markdown += `| ${name} | ${input.source} | ${required} | ${description} | ${example} |\n`;
    }
    markdown += `\n`;
  }

  // Example usage
  markdown += `**Example:**\n\n`;
  markdown += `\`\`\`typescript\n`;

  // Generate example with actual examples from schema
  const exampleParams = generateExampleParams(operation, spec);
  markdown += `const [data, error] = await client.request('${method.toUpperCase()} ${path}', ${
    Object.keys(exampleParams).length > 0
      ? formatExample(exampleParams)
      : '{}\n'
  });\n`;
  markdown += `\`\`\`\n\n`;

  // Possible errors
  if (errors.length > 0) {
    markdown += `**Possible Errors:**\n\n`;
    for (const error of errors) {
      markdown += `- \`${error}\`\n`;
    }
    markdown += `\n`;
  }

  // Example response if available
  if (operation.responses) {
    const responseExample = getResponseExample(spec, operation);
    if (responseExample) {
      markdown += `**Example Response:**\n\n`;
      markdown += `\`\`\`json\n${responseExample}\n\`\`\`\n\n`;
    }
  }

  return markdown;
}

/**
 * Extract example value from parameter, schema, or examples
 */
function extractExample(param: any, spec: OpenAPIObject): string {
  if (!param) return '-';

  // Direct example on parameter
  if ('example' in param && param.example !== undefined) {
    return formatExampleValue(param.example);
  }

  // Parameter has examples object
  if (
    'examples' in param &&
    param.examples &&
    Object.keys(param.examples).length > 0
  ) {
    const firstExampleKey = Object.keys(param.examples)[0];
    const exampleObj = param.examples[firstExampleKey];

    if (isExampleObject(exampleObj)) {
      return formatExampleValue(exampleObj.value);
    }

    if (isReferenceObject(exampleObj)) {
      const refExample = followRef(spec, exampleObj.$ref);
      if (isExampleObject(refExample)) {
        return formatExampleValue((refExample as any).value);
      }
    }
  }

  // Look for example in schema
  if ('schema' in param && param.schema) {
    const schema = isReferenceObject(param.schema)
      ? followRef(spec, param.schema.$ref)
      : param.schema;

    if ('example' in schema && schema.example !== undefined) {
      return formatExampleValue(schema.example);
    }

    if (
      'examples' in schema &&
      Array.isArray(schema.examples) &&
      schema.examples.length > 0
    ) {
      return formatExampleValue(schema.examples[0]);
    }
  }

  return '-';
}

/**
 * Get example JSON for successful response
 */
function getResponseExample(
  spec: OpenAPIObject,
  opObject: OperationObject,
): string | null {
  const successResponses = Object.entries(opObject.responses ?? {}).filter(
    ([code]) => code.startsWith('2'),
  );

  if (successResponses.length === 0) return null;

  const [_, response] = successResponses[0];
  const responseObj = isReferenceObject(response)
    ? followRef(spec, response.$ref)
    : response;

  // Check for examples in the response
  if (responseObj.content?.['application/json']?.examples) {
    const firstExample = Object.values(
      responseObj.content['application/json'].examples,
    )[0];

    if (isExampleObject(firstExample)) {
      return JSON.stringify(firstExample.value, null, 2);
    }

    if (isReferenceObject(firstExample)) {
      const exampleRef = followRef(spec, firstExample.$ref);
      if (isExampleObject(exampleRef)) {
        return JSON.stringify((exampleRef as any).value, null, 2);
      }
    }
  }

  // Check for direct example
  if (responseObj.content?.['application/json']?.example) {
    return JSON.stringify(
      responseObj.content['application/json'].example,
      null,
      2,
    );
  }

  // Check schema for example
  if (responseObj.content?.['application/json']?.schema) {
    const schema = responseObj.content['application/json'].schema;
    const schemaObj = isReferenceObject(schema)
      ? followRef(spec, schema.$ref)
      : schema;

    if ('example' in schemaObj && schemaObj.example !== undefined) {
      return JSON.stringify(schemaObj.example, null, 2);
    }
  }

  return '// Response structure according to schema';
}

function generateServersSection(servers: ServerObject[]): string {
  let markdown = `## Available Servers\n\n`;
  markdown += `The API can be accessed from the following servers:\n\n`;

  for (const server of servers) {
    markdown += `- \`${server.url}\` - ${server.description || 'No description'}\n`;

    // If server has variables, document them
    if (server.variables && Object.keys(server.variables).length > 0) {
      markdown += `  - Variables:\n`;
      for (const [varName, variable] of Object.entries(server.variables)) {
        markdown += `    - \`${varName}\`: ${variable.description || 'No description'} (Default: \`${variable.default}\`)\n`;
        if (variable.enum && variable.enum.length > 0) {
          markdown += `      - Possible values: ${variable.enum.map((v) => `\`${v}\``).join(', ')}\n`;
        }
      }
    }
  }
  markdown += `\n`;

  return markdown;
}

/**
 * Format a value for display in a markdown table
 */
function formatExampleValue(value: any): string {
  if (value === undefined || value === null) return '-';
  if (typeof value === 'object') return '`' + JSON.stringify(value) + '`';
  return '`' + String(value) + '`';
}

/**
 * Formats an example object for code display
 */
function formatExample(example: Record<string, any>): string {
  if (Object.keys(example).length === 0) return '{}';

  let result = '{\n';
  for (const [key, value] of Object.entries(example)) {
    const valueStr =
      typeof value === 'string'
        ? `"${value.replace(/"/g, '\\"')}"`
        : JSON.stringify(value);
    result += `  ${key}: ${valueStr},\n`;
  }
  result += '}';
  return result;
}

/**
 * Type guard for ExampleObject
 */
function isExampleObject(obj: any): obj is ExampleObject {
  return obj && typeof obj === 'object' && 'value' in obj;
}

/**
 * Type guard for ReferenceObject
 */
function isReferenceObject(obj: any): obj is ReferenceObject {
  return obj && typeof obj === 'object' && '$ref' in obj;
}

/**
 * Generate example parameters from the operation object and request body
 */
function generateExampleParams(
  opObject: OperationObject | undefined,
  spec: OpenAPIObject,
): Record<string, any> {
  if (!opObject) return {};

  const examples: Record<string, any> = {};

  // Handle parameters (path, query, header)
  if (opObject.parameters) {
    for (const param of opObject.parameters) {
      const parameter = isReferenceObject(param)
        ? (followRef(spec, param.$ref) as ParameterObject)
        : param;

      // Get example from parameter
      const exampleValue = extractParameterExample(parameter, spec);
      if (exampleValue !== undefined) {
        examples[parameter.name] = exampleValue;
      }
    }
  }

  // Handle request body
  if (opObject.requestBody) {
    Object.assign(
      examples,
      extractRequestBodyExamples(opObject.requestBody, spec),
    );
  }

  return examples;
}

/**
 * Extract example value from a parameter
 */
function extractParameterExample(
  parameter: ParameterObject,
  spec: OpenAPIObject,
): any {
  if (parameter.example !== undefined) {
    return parameter.example;
  }

  if (parameter.examples && Object.keys(parameter.examples).length > 0) {
    const firstExampleKey = Object.keys(parameter.examples)[0];
    const exampleObj = parameter.examples[firstExampleKey];

    if (isExampleObject(exampleObj)) {
      return exampleObj.value;
    }

    if (isReferenceObject(exampleObj)) {
      const refExample = followRef(spec, exampleObj.$ref);
      if (isExampleObject(refExample)) {
        return (refExample as any).value;
      }
    }
  }

  if (parameter.schema) {
    const schema = isReferenceObject(parameter.schema)
      ? (followRef(spec, parameter.schema.$ref) as SchemaObject)
      : parameter.schema;

    if (schema.example !== undefined) {
      return schema.example;
    }

    if (schema.examples && schema.examples.length > 0) {
      return schema.examples[0];
    }
  }

  return undefined;
}

/**
 * Extract examples from request body
 */
function extractRequestBodyExamples(
  requestBody: RequestBodyObject | ReferenceObject,
  spec: OpenAPIObject,
): Record<string, any> {
  const examples: Record<string, any> = {};

  const resolvedBody = isReferenceObject(requestBody)
    ? (followRef(spec, requestBody.$ref) as RequestBodyObject)
    : requestBody;

  if (!resolvedBody.content?.['application/json']) {
    return examples;
  }

  const content = resolvedBody.content['application/json'];

  // Check for examples object
  if (content.examples && Object.keys(content.examples).length > 0) {
    const firstExampleKey = Object.keys(content.examples)[0];
    const exampleObj = content.examples[firstExampleKey];

    if (isExampleObject(exampleObj)) {
      Object.assign(examples, exampleObj.value || {});
    } else if (isReferenceObject(exampleObj)) {
      const refExample = followRef(spec, exampleObj.$ref);
      if (isExampleObject(refExample)) {
        Object.assign(examples, (refExample as any).value || {});
      }
    }
    return examples;
  }

  // Check for direct example
  if (content.example) {
    Object.assign(examples, content.example);
    return examples;
  }

  // Check schema for examples
  if (content.schema) {
    const schema = isReferenceObject(content.schema)
      ? (followRef(spec, content.schema.$ref) as SchemaObject)
      : content.schema;

    if (schema.example) {
      Object.assign(examples, schema.example);
      return examples;
    }

    if (schema.properties) {
      // Get examples from properties
      for (const [propName, propSchema] of Object.entries(schema.properties)) {
        const propSchemaObj = isReferenceObject(propSchema)
          ? (followRef(spec, propSchema.$ref) as SchemaObject)
          : propSchema;

        if (propSchemaObj.example !== undefined) {
          examples[propName] = propSchemaObj.example;
        } else if (
          propSchemaObj.examples &&
          propSchemaObj.examples.length > 0
        ) {
          examples[propName] = propSchemaObj.examples[0];
        }
      }
    }
  }

  return examples;
}

/**
 * Find a parameter by name in the operation object
 */
function findParameterByName(
  opObject: OperationObject | undefined,
  name: string,
  spec: OpenAPIObject,
) {
  if (!opObject?.parameters) return undefined;

  // Look through parameters
  for (const param of opObject.parameters) {
    if (isReferenceObject(param)) {
      const resolvedParam = followRef(spec, param.$ref) as ParameterObject;
      if (resolvedParam.name === name) return resolvedParam;
    } else if (param.name === name) {
      return param;
    }
  }

  // Check requestBody for the parameter
  if (opObject.requestBody) {
    const requestBody = isReferenceObject(opObject.requestBody)
      ? (followRef(spec, opObject.requestBody.$ref) as RequestBodyObject)
      : opObject.requestBody;

    if (requestBody.content?.['application/json']?.schema) {
      const schema = requestBody.content['application/json'].schema;
      const schemaObj = isReferenceObject(schema)
        ? (followRef(spec, schema.$ref) as SchemaObject)
        : schema;

      if (schemaObj.properties?.[name]) {
        const propSchema = schemaObj.properties[name];
        return {
          name,
          in: 'body',
          required: schemaObj.required?.includes(name) ?? false,
          schema: propSchema,
          description: isReferenceObject(propSchema)
            ? undefined
            : propSchema.description,
          example: isReferenceObject(propSchema)
            ? undefined
            : propSchema.example,
        };
      }
    }
  }

  return undefined;
}

/**
 * Helper function to find operation in OpenAPI spec
 */
function findOperationInSpec(
  spec: OpenAPIObject,
  path: string,
  method: Method,
): OperationObject | undefined {
  const pathItem = spec.paths?.[path] as PathItemObject | undefined;
  if (!pathItem) return undefined;
  return pathItem[method] as OperationObject | undefined;
}
