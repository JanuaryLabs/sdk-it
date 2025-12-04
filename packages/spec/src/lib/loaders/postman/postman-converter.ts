import { parse } from 'fast-content-type-parse';
import type {
  ContentObject,
  OpenAPIObject,
  OperationObject,
  ParameterObject,
  PathsObject,
  RequestBodyObject,
  ResponseObject,
  SchemaObject,
  SecuritySchemeObject,
  TagObject,
} from 'openapi3-ts/oas31';

import type {
  Auth,
  Description,
  Folder,
  Header,
  Headers,
  Item,
  Items,
  PostmanCollection,
  PostmanRequest,
  QueryParam,
  Request,
  RequestBody,
  Url,
  Variable,
} from './spec-types';

function descriptionToText(description?: Description) {
  if (!description) {
    return undefined;
  }
  if (typeof description === 'string') {
    return description;
  }
  if (description.content) {
    return description.content;
  }
  return undefined;
}

type OurQueryParam = Omit<QueryParam, 'key'> & {
  key: string;
  description?: string;
};
type OurVariable = Omit<QueryParam, 'key'> & {
  key: string;
  description?: string;
};
type OurUrl = {
  path: string[];
  query: OurQueryParam[];
  variable: OurVariable[];
};

function isFolder(item: Items): item is Folder & { name: string } {
  return 'item' in item;
}

function isRequest(
  item: Items,
): item is Item & { name: string; request: Request } {
  return !!item.request;
}

/**
 * Recursively processes items and folders in a Postman collection
 * @param items Array of Postman items (requests or folders)
 * @param parentTags Array of parent folder tags for proper nesting
 */
function processItems(
  items: Items[],
  parentTags: string[],
  globalTags: TagObject[],
  paths: PathsObject,
  securitySchemes: Record<string, SecuritySchemeObject>,
) {
  for (const item of items) {
    if (!isFolder(item) && !isRequest(item)) {
      console.warn(
        `Skipping item ${item.name} because it is not a folder or request`,
      );
      continue;
    }

    if (isFolder(item)) {
      // Process folder-level auth if it exists
      if (item.auth) {
        processAuthScheme(item.auth, securitySchemes);
      }

      // Add this folder as a tag if not already added
      if (!globalTags.some((tag) => tag.name === item.name)) {
        globalTags.push({
          name: item.name,
          description: descriptionToText(item.description),
        });
      }

      const currentTags = [...parentTags, item.name];
      processItems(item.item, currentTags, globalTags, paths, securitySchemes);
    } else if (isRequest(item)) {
      // Process this request
      let operation: ReturnType<typeof requestToOperation>;
      if (typeof item.request === 'string') {
        const url = new URL(item.request);
        operation = requestToOperation(
          {
            name: url.pathname,
            response: [{ code: 200 }],
            request: {
              method: 'get',
              url: {
                path: url.pathname.split('/').slice(1),
              },
            },
          },
          securitySchemes,
        );
      } else {
        const auth = item.request.auth;
        operation = requestToOperation(
          {
            name: item.name,
            request: { ...item.request, auth },
            response: item.response,
          },
          securitySchemes,
        );
      }

      paths[operation.path] ??= {};
      Object.assign(paths[operation.path], {
        [operation.method]: {
          tags: parentTags.length ? parentTags : undefined,
          ...operation.operation,
        },
      });
    }
  }
}

function coerceVariable(query: Variable): OurVariable {
  if (!query.key) {
    throw new Error('Invalid query parameter format');
  }
  return {
    key: query.key,
    description: descriptionToText(query.description),
  };
}
function coerceQuery(query: QueryParam): OurQueryParam {
  if (!query.key) {
    throw new Error('Invalid query parameter format');
  }
  return {
    key: query.key,
    description: descriptionToText(query.description),
  };
}
function coerceUrl(url?: Url): OurUrl {
  if (!url) {
    throw new Error('Invalid URL format');
  }
  if (typeof url === 'string') {
    return {
      path: url.split('/').slice(1),
      query: [],
      variable: [],
    };
  }
  if (typeof url.path === 'string') {
    return {
      path: url.path.split('/').slice(1),
      query: (url.query ?? []).map(coerceQuery),
      variable: (url.variable ?? []).map(coerceVariable),
    };
  }
  return {
    path: (url.path ?? []).map((p) => {
      if (typeof p === 'string') {
        return p;
      }
      throw new Error('Invalid URL path format');
    }),
    query: (url.query ?? []).map(coerceQuery),
    variable: (url.variable ?? []).map(coerceVariable),
  };
}

function coerceResponseHeader(header?: Headers) {
  if (!header) {
    return [];
  }
  if (typeof header === 'string') {
    throw new Error(`Invalid header format: ${header}`);
  }
  return header.map((h) => {
    if (typeof h === 'string') {
      return {
        key: h,
        value: null,
      };
    }
    return h;
  });
}

/**
 * Process an auth scheme and add it to securitySchemes
 */
function processAuthScheme(
  auth: Auth,
  securitySchemes: Record<string, SecuritySchemeObject>,
): string | null {
  if (!auth || auth.type === 'noauth') return null;

  const getAuthAttr = (key: string): string | undefined => {
    if (!auth || auth.type === 'noauth') return undefined;
    const authType = auth[auth.type];
    if (!authType) return undefined;
    const attr = authType.find((a) => a.key === key);
    return attr ? String(attr.value) : undefined;
  };

  const schemeId = `${auth.type}Auth`;

  switch (auth.type) {
    case 'apikey': {
      const key = getAuthAttr('key') || 'api_key';
      const in_ = getAuthAttr('in') || 'header';
      securitySchemes[schemeId] = {
        type: 'apiKey',
        name: key,
        in: in_ as 'header' | 'query' | 'cookie',
        description: 'API key authentication',
      };
      break;
    }
    case 'basic':
      securitySchemes[schemeId] = {
        type: 'http',
        scheme: 'basic',
        description: 'Basic HTTP authentication',
      };
      break;
    case 'bearer': {
      const token = getAuthAttr('token');
      securitySchemes[schemeId] = {
        type: 'http',
        scheme: 'bearer',
        description: 'Bearer token authentication',
        ...(token ? { bearerFormat: 'JWT' } : {}),
      };
      break;
    }
    case 'oauth2': {
      const flowType = getAuthAttr('grant_type') || 'implicit';
      securitySchemes[schemeId] = {
        type: 'oauth2',
        description: 'OAuth 2.0 authentication',
        flows: {
          [flowType === 'authorization_code' ? 'authorizationCode' : flowType]:
            {
              authorizationUrl:
                getAuthAttr('authUrl') || 'https://example.com/oauth/authorize',
              tokenUrl:
                getAuthAttr('tokenUrl') || 'https://example.com/oauth/token',
              scopes: {},
            },
        },
      };
      break;
    }
    case 'digest':
      securitySchemes[schemeId] = {
        type: 'http',
        scheme: 'digest',
        description: 'Digest authentication',
      };
      break;
    case 'awsv4':
      securitySchemes[schemeId] = {
        type: 'apiKey',
        name: 'Authorization',
        in: 'header',
        description: 'AWS Signature v4 authentication',
      };
      break;
    default:
      securitySchemes[schemeId] = {
        type: 'apiKey',
        name: 'Authorization',
        in: 'header',
        description: `${auth.type} authentication`,
      };
  }

  return schemeId;
}

function generateSecurityRequirement(
  auth: Auth,
  securitySchemes: Record<string, SecuritySchemeObject>,
) {
  if (!auth || auth.type === 'noauth') return [];

  const schemeId = `${auth.type}Auth`;

  // Only include if the scheme was successfully processed
  if (securitySchemes[schemeId]) {
    return [{ [schemeId]: [] }];
  }

  return [];
}

function requestToOperation(
  item: Exclude<Item, 'name' | 'request'> & {
    name: string;
    request: PostmanRequest;
  },
  securitySchemes: Record<string, SecuritySchemeObject>,
) {
  const url = coerceUrl(item.request.url);
  const headers = Array.isArray(item.request.header)
    ? item.request.header
    : ([] as Header[]);

  const parameters: ParameterObject[] = [
    ...url.query
      .filter((param) => !param.disabled)
      .map((param) => {
        return {
          in: 'query',
          name: param.key,
          required: false,
          description: param.description,
          schema: {
            ...(param.value && !isNaN(Number(param.value))
              ? { type: 'number' }
              : param.value === 'true' || param.value === 'false'
                ? { type: 'boolean' }
                : { type: 'string' }),
          },
        } satisfies ParameterObject;
      }),

    ...url.variable.map((param) => {
      return {
        in: 'path',
        name: param.key,
        required: true,
        description: param.description,
        schema: {
          ...(param.value && !isNaN(Number(param.value))
            ? { type: 'number' }
            : param.value === 'true' || param.value === 'false'
              ? { type: 'boolean' }
              : { type: 'string' }),
        },
      } satisfies ParameterObject;
    }),

    ...headers
      .filter(
        (h) =>
          !h.disabled &&
          h.key.toLowerCase() !== 'accept' &&
          h.key.toLowerCase() !== 'content-type',
      )
      .map((header) => {
        return {
          in: 'header',
          name: header.key,
          required: false,
          description: descriptionToText(header.description),
          schema: {
            type: 'string',
          },
        } satisfies ParameterObject;
      }),
  ];

  // Extract Accept and Content-Type headers
  const acceptHeaderIdx = headers.findIndex(
    (h) => h.key.toLowerCase() === 'accept',
  );
  const contentTypeIdx = headers.findIndex(
    (h) => h.key.toLowerCase() === 'content-type',
  );
  const [acceptHeaderValue] =
    acceptHeaderIdx !== -1
      ? headers.splice(acceptHeaderIdx, 1).map((h) => h.value)
      : [];
  const [contentTypeValue] =
    contentTypeIdx !== -1
      ? headers.splice(contentTypeIdx, 1).map((h) => h.value)
      : [];

  let security;
  if (item.request.auth) {
    const schemeId = processAuthScheme(item.request.auth, securitySchemes);
    if (schemeId) {
      security = [{ [schemeId]: [] }];
    }
  }

  return {
    path: `/${url.path.join('/')}`.replace(/:([^/]+)/g, '{$1}'),
    method: (item.request.method ?? 'get').toLowerCase(),
    operation: {
      summary: item.name,
      description: descriptionToText(item.request.description),
      parameters,
      security,
      responses:
        !item.response || item.response.length === 0
          ? {
              200: {
                description: 'Successful response',
              },
            }
          : item.response.reduce((acc, response) => {
              const headers = coerceResponseHeader(response.header);
              const contentTypeIdx = headers.findIndex(
                (h) => h.key.toLowerCase() === 'content-type',
              );
              const [contentTypeValue] =
                contentTypeIdx !== -1
                  ? headers.splice(contentTypeIdx, 1).map((h) => h.value)
                  : [];

              let contentType = response.body
                ? parse(contentTypeValue || 'application/json')?.type
                : null;
              contentType ??= 'application/octet-stream';

              return {
                ...acc,
                [response.code ?? 200]: {
                  description: response.name
                    ? response.name
                    : `Response for ${response.code}`,
                  content: {
                    [contentType]: {
                      schema: bodyToSchema(response.body),
                    },
                  },
                } satisfies ResponseObject,
              };
            }, {}),
      requestBody: item.request.body
        ? requestBodyToOperationBody(
            contentTypeValue || 'application/json',
            item.request.body,
          )
        : undefined,
    } satisfies OperationObject,
  };
}

/**
 * Helper function to determine the likely type of a value
 */
function inferSchemaType(value: string | null): { type: string } {
  if (!value) return { type: 'string' };

  // Check if value is a number
  if (!isNaN(Number(value))) {
    return { type: 'number' };
  }

  // Check if value is a boolean
  if (value === 'true' || value === 'false') {
    return { type: 'boolean' };
  }

  // Default to string
  return { type: 'string' };
}

function requestBodyToOperationBody(
  contentType: string,
  body: RequestBody,
): RequestBodyObject {
  if (body.mode === 'raw') {
    return {
      content: {
        [contentType]: {
          schema: bodyToSchema(body.raw),
        },
      },
    };
  } else if (body.mode === 'urlencoded') {
    const properties: Record<string, any> = {};
    (body.urlencoded || [])
      .filter((param) => !param.disabled)
      .forEach((param) => {
        properties[param.key] = {
          type: 'string',
          description: descriptionToText(param.description),
        };
      });

    return {
      content: {
        'application/x-www-form-urlencoded': {
          schema: {
            type: 'object',
            properties,
          },
        },
      } satisfies ContentObject,
    };
  } else if (body.mode === 'formdata') {
    const properties: SchemaObject['properties'] = {};
    (body.formdata || [])
      .filter((param) => !param.disabled)
      .forEach((param) => {
        if (param.type === 'text') {
          properties[param.key] = {
            type: 'string',
            description: descriptionToText(param.description),
          };
        } else if (param.type === 'file') {
          properties[param.key] = {
            type: 'string',
            format: 'binary',
            description: descriptionToText(param.description),
          };
        }
      });

    return {
      content: {
        'multipart/form-data': {
          schema: {
            type: 'object',
            properties,
          },
        },
      } satisfies ContentObject,
    };
  }

  throw new Error(
    `Unsupported request body mode: ${body.mode}. Supported modes are: raw, urlencoded, formdata`,
  );
}

function bodyToSchema(bodyString?: string | null): SchemaObject | undefined {
  if (!bodyString) {
    return undefined;
  }

  let body: unknown;
  try {
    body = JSON.parse(bodyString.normalize('NFKD'));
  } catch (error) {
    console.warn(
      `Failed to parse JSON body: ${bodyString}. Treating as plain string.`,
      error,
    );
    return { type: 'string', example: bodyString };
  }

  return toSchema(body);
}

function toSchema(body: unknown | unknown[]): any {
  const typeMap: Record<string, string> = {
    '<number>': 'number',
    '<string>': 'string',
    '<boolean>': 'boolean',
    false: 'boolean',
    true: 'boolean',
  };
  if (Array.isArray(body)) {
    return {
      type: 'array',
      items: toSchema(body[0]),
    };
  }
  if (typeof body === 'object' && body !== null) {
    const properties: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(body)) {
      properties[key] = toSchema(value);
    }
    return {
      type: 'object',
      properties,
    };
  }
  if (typeof body === 'string') {
    return {
      type: typeMap[body] ?? 'string',
    };
  }
  if (typeof body === 'number') {
    return {
      type: 'number',
    };
  }
  if (typeof body === 'boolean') {
    return {
      type: 'boolean',
    };
  }
  if (body === null) {
    return {
      type: 'null',
    };
  }
  console.warn(`Unknown type for body: ${body}. Defaulting to string.`, body);
  return {
    type: 'string',
  };
}

export function convertPostmanToOpenAPI(
  collection: PostmanCollection,
): OpenAPIObject {
  const tags: TagObject[] = [];
  const paths: PathsObject = {};
  const securitySchemes: Record<string, SecuritySchemeObject> = {};

  if (collection.auth) {
    processAuthScheme(collection.auth, securitySchemes);
  }
  processItems(collection.item, [], tags, paths, securitySchemes);
  return {
    openapi: '3.1.0',
    info: {
      title: collection.info.name,
      version: '1.0.0',
      description: descriptionToText(collection.info.description),
    },
    tags,
    paths,
    // Only add security at top level if there's collection auth
    security: collection.auth
      ? generateSecurityRequirement(collection.auth, securitySchemes)
      : undefined,
    components:
      Object.keys(securitySchemes).length > 0
        ? {
            securitySchemes,
          }
        : undefined,
  };
}
