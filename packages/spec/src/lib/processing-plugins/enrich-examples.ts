import type {
  MediaTypeObject,
  OperationObject,
  RequestBodyObject,
  ResponseObject,
  SchemaObject,
} from 'openapi3-ts/oas31';

import { resolveRef } from '@sdk-it/core/ref.js';

import { iterateOperations } from '../for-each-operation.js';
import type { ProcessingDiagnostic, ProcessingPlugin } from '../processing.js';
import type { IR } from '../types.js';

export interface ExampleEnrichmentInput {
  spec: IR;
  operation: OperationObject;
  method: string;
  path: string;
  direction: 'request' | 'response';
  mediaType: string;
  schema: SchemaObject;
  statusCode?: string;
  signal?: AbortSignal;
}

export interface ExampleValidationInput extends ExampleEnrichmentInput {
  value: unknown;
}

export interface ExampleEnrichmentOptions {
  name?: string;
  overwrite?: boolean;
  generate(input: ExampleEnrichmentInput): unknown | Promise<unknown>;
  validate(input: ExampleValidationInput): boolean | Promise<boolean>;
}

function hasAuthoredExample(media: MediaTypeObject): boolean {
  return (
    Object.prototype.hasOwnProperty.call(media, 'example') ||
    Object.keys(media.examples ?? {}).length > 0
  );
}

async function enrichMediaType(
  input: Omit<ExampleEnrichmentInput, 'schema'> & {
    media: MediaTypeObject;
  },
  options: ExampleEnrichmentOptions,
  report: (
    diagnostic: Omit<ProcessingDiagnostic, 'plugin'>,
  ) => ProcessingDiagnostic,
) {
  const { media, ...target } = input;
  if (!media.schema || (!options.overwrite && hasAuthoredExample(media))) {
    return;
  }

  target.signal?.throwIfAborted();
  const schema = resolveRef<SchemaObject>(target.spec, media.schema);
  const enrichmentInput = { ...target, schema };
  const value = await options.generate(enrichmentInput);
  target.signal?.throwIfAborted();

  if (!(await options.validate({ ...enrichmentInput, value }))) {
    report({
      severity: 'warning',
      code: 'generated-example-invalid',
      message: `Discarded an invalid generated ${target.direction} example`,
      path: `${target.method.toUpperCase()} ${target.path}`,
    });
    return;
  }

  media.example = value;
  report({
    severity: 'info',
    code: 'example-generated',
    message: `Generated a schema-valid ${target.direction} example`,
    path: `${target.method.toUpperCase()} ${target.path}`,
  });
}

export function enrichExamples(
  options: ExampleEnrichmentOptions,
): ProcessingPlugin {
  return {
    name: options.name ?? 'enrich-examples',
    async process({ spec, report, signal }) {
      for (const { entry, operation } of iterateOperations(spec)) {
        if (operation.requestBody) {
          const requestBody = resolveRef<RequestBodyObject>(
            spec,
            operation.requestBody,
          );
          for (const [mediaType, media] of Object.entries(
            requestBody.content,
          )) {
            await enrichMediaType(
              {
                spec,
                operation,
                method: entry.method,
                path: entry.path,
                direction: 'request',
                mediaType,
                media,
                signal,
              },
              options,
              report,
            );
          }
        }

        for (const [statusCode, responseOrRef] of Object.entries(
          operation.responses ?? {},
        )) {
          const response = resolveRef<ResponseObject>(spec, responseOrRef);
          for (const [mediaType, media] of Object.entries(
            response.content ?? {},
          )) {
            await enrichMediaType(
              {
                spec,
                operation,
                method: entry.method,
                path: entry.path,
                direction: 'response',
                statusCode,
                mediaType,
                media,
                signal,
              },
              options,
              report,
            );
          }
        }
      }
    },
  };
}
