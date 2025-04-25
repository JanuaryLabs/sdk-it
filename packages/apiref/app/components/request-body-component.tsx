import type {
  ExampleObject,
  OpenAPIObject,
  RequestBodyObject,
} from 'openapi3-ts/oas31';
import React from 'react';

import { followRef, isEmpty, isRef } from '@sdk-it/core';

import { Separator } from '../shadcn/separator';
import { Description } from './description';
import { SchemaProperty } from './schema-component';

interface RequestBodyComponentProps {
  requestBody: RequestBodyObject;
  spec: OpenAPIObject;
  className?: string;
}

export const RequestBodyComponent: React.FC<RequestBodyComponentProps> = ({
  requestBody,
  spec,
  className,
}) => {
  if (!requestBody || isEmpty(requestBody.content)) {
    return null;
  }

  return (
    <div className={className}>
      <h4 className="text-lg font-semibold">Request Body</h4>

      <Description description={requestBody.description} />

      {Object.entries(requestBody.content).map(([contentType, mediaType]) => {
        let schema = isRef(mediaType.schema)
          ? followRef(spec, mediaType.schema.$ref)
          : mediaType.schema;
        if (!schema) {
          return null;
        }
        if (schema.type !== 'object') {
          schema = {
            type: 'object',
            required: [requestBody.required ? '$body' : ''],
            properties: {
              $body: schema,
            },
          };
        }
        return (
          <div key={contentType}>
            {schema && (
              <div className="space-y-1">
                {Object.entries(schema.properties || {}).map(
                  ([propName, propSchema]) => (
                    <>
                      <Separator className="my-4" />
                      <SchemaProperty
                        key={propName}
                        name={propName}
                        schema={propSchema}
                        required={(schema.required || []).includes(propName)}
                        level={0}
                        isNested
                      />
                    </>
                  ),
                )}
              </div>
            )}

            {mediaType.example && (
              <div className="request-example">
                <h6>Example:</h6>
                <pre>{JSON.stringify(mediaType.example, null, 2)}</pre>
              </div>
            )}

            {mediaType.examples &&
              Object.entries(mediaType.examples).length > 0 && (
                <div className="request-examples">
                  <h6>Examples:</h6>
                  {Object.entries(mediaType.examples).map(
                    ([exampleName, example]) => {
                      const resolvedExample = isRef(example)
                        ? followRef<ExampleObject>(spec, example.$ref)
                        : example;

                      return (
                        <div key={exampleName} className="example-item">
                          <h6>{exampleName}</h6>
                          {resolvedExample.summary && (
                            <p>{resolvedExample.summary}</p>
                          )}
                          <pre>
                            {JSON.stringify(resolvedExample.value, null, 2)}
                          </pre>
                        </div>
                      );
                    },
                  )}
                </div>
              )}
          </div>
        );
      })}
    </div>
  );
};
