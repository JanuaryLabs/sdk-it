import type { OpenAPIObject } from 'openapi3-ts/oas31';
import React from 'react';

import type { TunedOperationObject } from '@sdk-it/spec/operation.js';

import { JSXEmitter } from './jsx-emitter';

interface OperationDetailsComponentProps {
  spec: OpenAPIObject;
  path: string;
  method: string;
  operation: TunedOperationObject;
}

export const OperationDetailsComponent: React.FC<
  OperationDetailsComponentProps
> = ({ spec, path, method, operation }) => {
  const emitter = new JSXEmitter(spec);
  const operationDetails = emitter.handle(operation);

  return (
    <div className="operation-details-wrapper">
      <h3 className="operation-title">
        <span className={`method-badge method-${method.toLowerCase()}`}>
          {method.toUpperCase()}
        </span>
        <span className="operation-path">{path}</span>
      </h3>

      {operation.summary && (
        <div className="operation-summary">{operation.summary}</div>
      )}

      <div>{operationDetails}</div>
    </div>
  );
};
