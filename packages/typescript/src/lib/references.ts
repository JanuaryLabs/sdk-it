import type { RequestEncoding } from '@sdk-it/spec';

import { groupIdentifier } from './group-identifier.ts';

/** The runtime declarations that emitted code refers to, besides the response classes. */
export type RuntimeName =
  | RequestEncoding
  | 'toRequest'
  | 'Dispatcher'
  | 'fetchType'
  | 'Interceptor'
  | 'chunked'
  | 'sse'
  | 'bodyless'
  | 'SSEListener'
  | 'Client'
  | 'ClientSettings'
  | 'EndpointsOf'
  | 'createClient'
  | 'stringCredentialSchema'
  | 'basicCredentialSchema'
  | 'mutualTlsCredentialSchema';

/** The globals that emitted code refers to. */
export type EmittedGlobal =
  'Blob' | 'Date' | 'Record' | 'AbortSignal' | 'ReadableStream';

/**
 * How emitted code names a declaration that another part of the SDK makes.
 * A multi-file SDK reaches other files through the namespace imports each file
 * makes (`models.Pet`, `pets.listPetsSchema`, `http.Ok`); a one-module SDK
 * declares everything in one scope.
 */
export interface References {
  /** A model type, by its TypeScript name. */
  model(typeName: string): string;
  /** The schema const of an operation input in `group`. */
  input(group: string, schemaName: string): string;
  /** A runtime response class: `Ok`, `NotFound`, `APIError`, … */
  status(className: string): string;
  runtime(name: RuntimeName): string;
  global(name: EmittedGlobal): string;
}

/**
 * The names a file of the multi-file SDK uses. Each file imports models as
 * `modelNamespace` (`models` from a model file, `outputs` from an endpoint
 * file), the response classes as `http` and other runtime declarations by name.
 */
export function fileReferences(
  modelNamespace: 'models' | 'outputs',
): References {
  return {
    model: (typeName) => `${modelNamespace}.${typeName}`,
    input: (group, schemaName) => `${groupIdentifier(group)}.${schemaName}`,
    status: (className) => `http.${className}`,
    runtime: (name) => name,
    global: (name) => name,
  };
}
