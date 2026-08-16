import type {
  ComponentsObject,
  OpenAPIObject,
  ReferenceObject,
  SecuritySchemeObject,
} from 'openapi3-ts/oas31';

export interface OpenAPIOAuthFlowObject {
  authorizationUrl?: string;
  deviceAuthorizationUrl?: string;
  tokenUrl?: string;
  refreshUrl?: string;
  scopes: Record<string, string>;
  [extension: `x-${string}`]: unknown;
}

export interface OpenAPIOAuthFlowsObject {
  implicit?: OpenAPIOAuthFlowObject;
  password?: OpenAPIOAuthFlowObject;
  clientCredentials?: OpenAPIOAuthFlowObject;
  authorizationCode?: OpenAPIOAuthFlowObject;
  deviceAuthorization?: OpenAPIOAuthFlowObject;
  [extension: `x-${string}`]: unknown;
}

export type OpenAPISecuritySchemeObject =
  | (SecuritySchemeObject & { deprecated?: boolean })
  | (Omit<SecuritySchemeObject, 'type' | 'flows'> & {
      type: 'oauth2';
      flows: OpenAPIOAuthFlowsObject;
      oauth2MetadataUrl?: string;
      deprecated?: boolean;
    })
  | {
      type: 'mutualTLS';
      description?: string;
      deprecated?: boolean;
      [extension: `x-${string}`]: unknown;
    };

export type OpenAPIComponentsObject = Omit<
  ComponentsObject,
  'securitySchemes'
> & {
  securitySchemes?: Record<
    string,
    OpenAPISecuritySchemeObject | ReferenceObject
  >;
};

export type OpenAPIDocument = Omit<OpenAPIObject, 'components'> & {
  components?: OpenAPIComponentsObject;
};
