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
} from 'openapi3-ts/oas31';

import type { SidebarData } from './sidebar.ts';

export interface OurOpenAPIObject extends OpenAPIObject {
  'x-sdk-augmented'?: boolean;
  'x-docs': SidebarData;
  components: Omit<ComponentsObject, 'schemas'> & {
    schemas: Record<string, SchemaObject | ReferenceObject>;
    securitySchemes: Record<string, SecuritySchemeObject | ReferenceObject>;
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
  responses: Record<string, ResponseObject>;
  requestBody: OurRequestBodyObject;
};

export interface OperationEntry {
  name?: string;
  method: string;
  path: string;
  groupName: string;
  tag: string;
}
export type Operation = {
  entry: OperationEntry;
  operation: TunedOperationObject;
};
