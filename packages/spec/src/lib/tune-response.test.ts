import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type {
  OpenAPIObject,
  ReferenceObject,
  ResponseObject,
  SchemaObject,
} from 'openapi3-ts/oas31';

import { toIR } from '@sdk-it/spec';

function buildSpec(options: {
  contentType: string;
  schema?: SchemaObject;
  headers?: ResponseObject['headers'];
}): OpenAPIObject {
  const { contentType, schema, headers } = options;
  return {
    openapi: '3.1.0',
    info: {
      title: 'Test API',
      version: '1.0.0',
    },
    components: {
      schemas: {},
      securitySchemes: {},
    },
    paths: {
      '/text': {
        get: {
          operationId: 'getText',
          responses: {
            '200': {
              description: 'OK',
              headers,
              content: {
                [contentType]: {
                  ...(schema ? { schema } : {}),
                },
              },
            },
          },
        },
      },
    },
  };
}

function getResponseArtifacts(
  spec: ReturnType<typeof toIR>,
  contentType: string,
) {
  const response = spec.paths['/text'].get?.responses?.['200'] as ResponseObject;
  const outputName = response['x-response-name'] as string;
  const schemaRef = response.content?.[contentType].schema as ReferenceObject;
  const schema = spec.components.schemas[outputName] as Record<string, unknown>;
  return { response, outputName, schemaRef, schema };
}

describe('resolveResponses text output', () => {
  test('defaults empty text schema to string', () => {
    const spec = toIR({ spec: buildSpec({ contentType: 'text/plain' }) }, false);
    const { schemaRef, schema, outputName } = getResponseArtifacts(
      spec,
      'text/plain',
    );

    assert.equal(schemaRef.$ref, `#/components/schemas/${outputName}`);
    assert.equal(schema.type, 'string');
    assert.equal(schema['x-stream'], false);
  });

  test('defaults text schema when content-type has parameters', () => {
    const contentType = 'text/html; charset=utf-8';
    const spec = toIR({ spec: buildSpec({ contentType }) }, false);
    const { schemaRef, schema, outputName } = getResponseArtifacts(
      spec,
      contentType,
    );

    assert.equal(schemaRef.$ref, `#/components/schemas/${outputName}`);
    assert.equal(schema.type, 'string');
    assert.equal(schema['x-stream'], false);
  });

  test('keeps explicit text schema fields', () => {
    const spec = toIR(
      {
        spec: buildSpec({
          contentType: 'text/plain',
          schema: {
            type: 'string',
            maxLength: 5,
          },
        }),
      },
      false,
    );
    const { schema } = getResponseArtifacts(spec, 'text/plain');

    assert.equal(schema.type, 'string');
    assert.equal(schema.maxLength, 5);
    assert.equal(schema['x-stream'], false);
  });

  test('does not override explicit object schema for text content', () => {
    const spec = toIR(
      {
        spec: buildSpec({
          contentType: 'text/plain',
          schema: {
            type: 'object',
            properties: {
              value: { type: 'string' },
            },
          },
        }),
      },
      false,
    );
    const { schema } = getResponseArtifacts(spec, 'text/plain');

    assert.equal(schema.type, 'object');
    const properties = schema.properties as Record<string, { type?: string }>;
    assert.equal(properties.value?.type, 'string');
    assert.equal(schema['x-stream'], false);
  });
});

describe('resolveResponses binary output', () => {
  test('octet-stream with content-disposition becomes binary and buffered', () => {
    const contentType = 'application/octet-stream; charset=binary';
    const spec = toIR(
      {
        spec: buildSpec({
          contentType,
          headers: {
            'Content-Disposition': {
              schema: { type: 'string' },
            },
          },
        }),
      },
      false,
    );
    const { schema } = getResponseArtifacts(spec, contentType);

    assert.equal(schema.type, 'string');
    assert.equal(schema.format, 'binary');
    assert.equal(schema['x-stream'], false);
  });

  test('octet-stream without content-disposition stays streamed', () => {
    const contentType = 'application/octet-stream';
    const spec = toIR({ spec: buildSpec({ contentType }) }, false);
    const { schema } = getResponseArtifacts(spec, contentType);

    assert.equal(schema.type, undefined);
    assert.equal(schema.format, undefined);
    assert.equal(schema['x-stream'], true);
  });
});
