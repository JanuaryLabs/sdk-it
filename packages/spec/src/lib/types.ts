import type {
  MediaTypeObject,
  OperationObject,
  ParameterObject,
  PathsObject,
  ReferenceObject,
  RequestBodyObject,
  ResponseObject,
  SchemaObject,
  ServerObject,
  TagObject,
} from 'openapi3-ts/oas31';

import type {
  OpenAPIComponentsObject,
  OpenAPIDocument,
  OpenAPISecuritySchemeObject,
} from '@sdk-it/core';

import type { PaginationGuess } from './pagination/guess-pagination.js';
import type { SidebarData, TagGroups } from './sidebar.js';

export type IR = Omit<
  OpenAPIDocument,
  'components' | 'paths' | 'servers' | 'tags'
> & {
  servers: ServerObject[];
  'x-sdk-processing'?: {
    plugins: string[];
    configuration: string;
  };
  'x-docs': SidebarData;
  'x-tagGroups': TagGroups[];
  components: Omit<OpenAPIComponentsObject, 'schemas' | 'securitySchemes'> & {
    schemas: Record<string, SchemaObject | ReferenceObject>;
    securitySchemes: Record<string, OpenAPISecuritySchemeObject>;
  };
  paths: PathsObject;
  tags: TagObject[];
};

export interface OurRequestBodyObject extends RequestBodyObject {
  content: Record<
    string,
    Omit<MediaTypeObject, 'schema'> & { schema: ReferenceObject }
  >;
}

export type TunedOperationObject = Omit<
  OperationObject,
  'operationId' | 'tags' | 'parameters' | 'responses' | 'requestBody' | 'tags'
> & {
  tags: string[];
  operationId: string;
  parameters: ParameterObject[];
  ['x-fn-name']: string;
  ['x-fn-group']?: string;
  responses: Record<
    string,
    Omit<ResponseObject, 'content'> & {
      content: Record<string, MediaTypeObject>;
    }
  >;
  requestBody: OurRequestBodyObject;
};

export interface OperationEntry {
  method: string;
  path: string;
  tag: string;
}
export type Operation = {
  entry: OperationEntry;
  operation: TunedOperationObject;
};

export type OperationPagination = PaginationGuess & {
  items: string;
  statusCode: number;
};
