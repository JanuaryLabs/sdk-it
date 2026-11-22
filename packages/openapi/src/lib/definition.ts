import type {
  ExternalDocumentationObject,
  InfoObject,
  OpenAPIObject,
  OperationObject,
  ReferenceObject,
  SchemaObject,
  SecurityRequirementObject,
  SecuritySchemeObject,
  ServerObject,
  TagObject,
} from 'openapi3-ts/oas31';

import type { Method } from '@sdk-it/core';

/**
 * What code cannot know about a backend's OpenAPI 3.1 or 3.2 document. The
 * paths, schemas and responses come from the analysis, so a base document
 * cannot hold them.
 */
export interface BaseDocument {
  openapi: '3.1.0' | '3.2.0';
  info: InfoObject;
  servers?: ServerObject[];
  security?: SecurityRequirementObject[];
  externalDocs?: ExternalDocumentationObject;
  /** Tag objects; each tag an operation names gets this object's fields. */
  tags?: TagObject[];
  components?: {
    securitySchemes?: Record<string, SecuritySchemeObject | ReferenceObject>;
  };
}

/** A middleware, named by its export and its file, and the security requirements of each route it guards. */
export interface MiddlewareSecurityRule {
  middleware: { import: string; from: URL };
  security: SecurityRequirementObject[];
  values?: { scheme: string; argument: number; mode: 'any' | 'all' };
}

/** Changes one operation in place, after the document is put together. */
export type OperationTransformer = (
  operation: OperationObject,
  context: { method: Method; path: string; document: OpenAPIObject },
) => void | Promise<void>;

/** Changes the document in place, after every operation transformer has run. */
export type DocumentTransformer = (
  document: OpenAPIObject,
) => void | Promise<void>;

/** How a backend's OpenAPI document is produced: what its module default-exports. */
export interface OpenApiDefinition {
  /** The backend's tsconfig, as a URL, so the document does not depend on the reader's working directory. */
  tsconfig: URL;
  document: BaseDocument;
  /** A TypeScript type name and the JSON Schema written in its place, added onto the defaults. */
  types?: Readonly<Record<string, SchemaObject>>;
  /** Named imports an `against` may read, beyond `z`, namespace imports and the Prisma preset's. */
  allowedNamedImports?: readonly string[];
  middlewareSecurity?: readonly MiddlewareSecurityRule[];
  transformers?: {
    operation?: readonly OperationTransformer[];
    document?: readonly DocumentTransformer[];
  };
}

/** The definition, as written; it gives the module's default export its type. */
export function defineOpenApi(
  definition: OpenApiDefinition,
): OpenApiDefinition {
  return definition;
}
