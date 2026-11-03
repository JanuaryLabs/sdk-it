import type {
  MediaTypeObject,
  OperationObject,
  ParameterObject,
  PathsObject,
  ReferenceObject,
  RequestBodyObject,
  ResponseObject,
  SchemaObject,
  SecurityRequirementObject,
  ServerObject,
  TagObject,
} from 'openapi3-ts/oas31';

import type {
  OpenAPIComponentsObject,
  OpenAPIDocument,
  OpenAPISecuritySchemeObject,
} from '@sdk-it/core';
import type { Method } from '@sdk-it/core/paths.js';

import type { SdkDoc } from './overview-docs/types.js';
import type {
  NoPaginationResult,
  PaginationGuess,
} from './pagination/guess-pagination.js';
import type { SidebarData, TagGroups } from './sidebar.js';

type SpecDocument<Paths> = Omit<
  OpenAPIDocument,
  'components' | 'paths' | 'servers' | 'tags'
> & {
  servers: ServerObject[];
  'x-sdk-processing'?: {
    plugins: string[];
    configuration: string;
  };
  'x-docs': SidebarData;
  'x-sdks': SdkDoc[];
  'x-tagGroups': TagGroups[];
  components: Omit<OpenAPIComponentsObject, 'schemas' | 'securitySchemes'> & {
    schemas: Record<string, SchemaObject | ReferenceObject>;
    securitySchemes: Record<string, OpenAPISecuritySchemeObject>;
  };
  paths: Paths;
  tags: TagObject[];
};

/** The document the document-stage plugins rewrite: its operations are still raw OpenAPI. */
export type ProcessingDocument = SpecDocument<PathsObject>;

export type IRPaths = Record<
  string,
  Partial<Record<Method, TunedOperationObject>>
>;

/** The processed spec: every operation is a {@link TunedOperationObject} built by `finalizeOperations`. */
export type IR = SpecDocument<IRPaths>;

export interface OurRequestBodyObject extends RequestBodyObject {
  content: Record<
    string,
    Omit<MediaTypeObject, 'schema'> & { schema: ReferenceObject }
  >;
}

export const responseBodies = [
  'json',
  'text',
  'binary',
  'stream',
  'sse',
  'empty',
] as const;

export type ResponseBody = (typeof responseBodies)[number];

export type TunedResponseObject = Omit<ResponseObject, 'content'> & {
  content: Record<string, MediaTypeObject>;
  'x-body': ResponseBody;
  'x-response-name'?: string;
};

export type TunedOperationObject = Omit<
  OperationObject,
  | 'operationId'
  | 'tags'
  | 'parameters'
  | 'responses'
  | 'requestBody'
  | 'security'
  | `x-${string}`
> & {
  tags: [string];
  operationId: string;
  parameters: ParameterObject[];
  security: SecurityRequirementObject[];
  ['x-fn-name']: string;
  ['x-fn-group']: string;
  ['x-pagination']?: OperationPagination;
  ['x-tool']?: OperationTool;
  responses: Record<string, TunedResponseObject>;
  requestBody: OurRequestBodyObject;
};

/** The agent tool an operation is exposed as (`x-tool`). */
export interface OperationTool {
  name?: string;
  description?: string;
}

export interface OperationEntry {
  method: Method;
  path: string;
  tag: string;
}
export type Operation = {
  entry: OperationEntry;
  operation: TunedOperationObject;
};

/** Spec processing stores a pagination only when one was configured or detected. */
export type OperationPagination = Exclude<
  PaginationGuess,
  NoPaginationResult
> & {
  items: string;
  statusCode: number;
};
