import type {
  HeaderObject,
  OpenAPIObject,
  ReferenceObject,
  ResponseObject,
  ResponsesObject,
} from 'openapi3-ts/oas31';
import React from 'react';

import { followRef, isRef } from '@sdk-it/core';

import { SchemaComponent } from './schema-component';

interface ResponsesComponentProps {
  responses: ResponsesObject;
  spec: OpenAPIObject;
  className?: string;
}

export const ResponsesComponent: React.FC<ResponsesComponentProps> = ({
  responses,
  spec,
  className,
}) => {
  if (!responses || Object.keys(responses).length === 0) {
    return null;
  }

  return (
    <div className={className}>
      <h4 className="text-lg font-semibold">Responses</h4>

      {Object.entries(responses as Record<string, ResponseObject>).map(
        ([statusCode, response]) => {
          return (
            <div key={statusCode} className="response-item">
              <h5 className="response-status">
                <code>{statusCode}</code> {response.description}
              </h5>

              {response.content &&
                Object.entries(response.content).map(
                  ([contentType, mediaType]) => (
                    <div key={contentType} className="response-content-type">
                      {mediaType.schema && (
                        <div className="response-schema">
                          <SchemaComponent schema={mediaType.schema} />
                        </div>
                      )}

                      {mediaType.example && (
                        <div className="response-example">
                          <h6>Example:</h6>
                          <pre>
                            {JSON.stringify(mediaType.example, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  ),
                )}

              {response.headers && Object.keys(response.headers).length > 0 && (
                <div className="response-headers">
                  <h6>Headers:</h6>
                  {Object.entries(response.headers).map(
                    ([headerName, headerSchema]) => {
                      const header = isRef(headerSchema)
                        ? followRef<ReferenceObject>(spec, headerSchema.$ref)
                        : headerSchema;
                      const resolvedHeader = isRef(header)
                        ? followRef<HeaderObject>(spec, header.$ref)
                        : header;

                      return (
                        <div key={headerName} className="response-header">
                          <code>{headerName}</code>
                          {resolvedHeader.description && (
                            <div className="header-description">
                              {resolvedHeader.description}
                            </div>
                          )}
                          {resolvedHeader.schema && (
                            <SchemaComponent schema={resolvedHeader.schema} />
                          )}
                        </div>
                      );
                    },
                  )}
                </div>
              )}
            </div>
          );
        },
      )}
    </div>
  );
};
