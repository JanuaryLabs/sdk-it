import type { OpenAPIObject, ParameterObject } from 'openapi3-ts/oas31';
import React from 'react';

import { Separator } from '../shadcn/separator';
import { Description } from './description';
import { SchemaComponent } from './schema-component';

interface ParametersComponentProps {
  parameters: ParameterObject[];
  type: 'path' | 'query' | 'header';
  title?: string;
  spec: OpenAPIObject;
}

export const ParametersComponent: React.FC<ParametersComponentProps> = ({
  parameters,
  type,
  title,
  spec,
}) => {
  const filteredParams = parameters.filter((it) => it.in === type);

  if (filteredParams.length === 0) {
    return null;
  }

  return (
    <div>
      <h4 className="text-lg font-semibold">
        {title || `${type.charAt(0).toUpperCase() + type.slice(1)} Parameters`}
      </h4>
      <div className="space-y-2">
        {filteredParams.map((parameter, index) => {
          return (
            <div key={index}>
              <Separator className="my-4" />
              <div className="flex items-center gap-x-1 mb-0.5">
                <code className="text-sm">{parameter.name}</code>
                {parameter.schema && (
                  <SchemaComponent
                    schema={parameter.schema}
                    required={parameter.required}
                  />
                )}
              </div>

              <Description description={parameter.description} />

              {parameter.example && (
                <div>
                  <strong>Example:</strong> {JSON.stringify(parameter.example)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
