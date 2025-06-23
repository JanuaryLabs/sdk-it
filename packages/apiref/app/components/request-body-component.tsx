/* eslint-disable @nx/enforce-module-boundaries */
import type { OpenAPIObject } from 'openapi3-ts/oas31';
import React, { Fragment } from 'react';

import { resolveRef } from '@sdk-it/core/ref.js';
import { isEmpty } from '@sdk-it/core/utils.js';
import type { OurRequestBodyObject } from '@sdk-it/spec';

import { Separator } from '../shadcn/separator';
import { Description } from './description';
import { SchemaComponent } from './schema-component';

interface RequestBodyComponentProps {
  requestBody: OurRequestBodyObject;
  spec: OpenAPIObject;
  className?: string;
}

export const RequestBodyComponent: React.FC<RequestBodyComponentProps> = ({
  requestBody,
  spec,
  className,
}) => {
  const isEmpty = requestBody.content['application/empty'];
  if (isEmpty) {
    return null;
  }

  return (
    <div className={className}>
      <h4 className="text-lg font-semibold">Request Body</h4>

      <Description description={requestBody.description} />

      {Object.entries(requestBody.content).map(([contentType, mediaType]) => {
        let schema = resolveRef(spec, mediaType.schema);

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
                      <SchemaComponent
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
