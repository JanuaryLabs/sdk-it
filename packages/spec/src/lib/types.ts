import type {
  ComponentsObject,
  MediaTypeObject,
  OpenAPIObject,
  OperationObject,
  ParameterObject,
  PathsObject,
  ReferenceObject,
  RequestBodyObject,
  ResponseObject,
  SchemaObject,
  SecuritySchemeObject,
  ServerObject,
} from 'openapi3-ts/oas31';

import type { PaginationGuess } from './pagination/guess-pagination.js';
import type { SidebarData, TagGroups } from './sidebar.js';

export interface IR extends OpenAPIObject {
  servers: ServerObject[];
  'x-sdk-augmented'?: boolean;
  'x-docs': SidebarData;
  'x-tagGroups': TagGroups[];
  components: Omit<ComponentsObject, 'schemas'> & {
    schemas: Record<string, SchemaObject | ReferenceObject>;
    securitySchemes: Record<string, SecuritySchemeObject>;
  };
  paths: PathsObject;
}

export interface OurRequestBodyObject extends RequestBodyObject {
  content: Record<
    string,
    Omit<MediaTypeObject, 'schema'> & { schema: ReferenceObject }
  >;
}

export type TunedOperationObject = Omit<
  OperationObject,
  'operationId' | 'tags' | 'parameters' | 'responses' | 'requestBody'
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
};
