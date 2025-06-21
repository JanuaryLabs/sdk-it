import type { OpenAPIObject } from 'openapi3-ts/oas31';
import React, { Fragment } from 'react';

import { isEmpty } from '@sdk-it/core';
import type { TunedRequestBody } from '@sdk-it/spec';

import { Separator } from '../shadcn/separator';
import { Description } from './description';
import { SchemaProperty } from './schema-component';

interface RequestBodyComponentProps {
  requestBody: TunedRequestBody;
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
        let schema = mediaType.schema;
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
                    <Fragment key={propName}>
                      <Separator className="my-4" />
                      <SchemaProperty
                        key={propName}
                        name={propName}
                        schema={propSchema}
                        required={(schema.required || []).includes(propName)}
                        level={0}
                        isNested
                      />
                    </Fragment>
                  ),
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
