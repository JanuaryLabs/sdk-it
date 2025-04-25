import type { OpenAPIObject } from 'openapi3-ts/oas31';
import React from 'react';

import type { TunedOperationObject } from '@sdk-it/spec/operation.js';

import { ParametersComponent } from './parameters-component';
import { RequestBodyComponent } from './request-body-component';
import { ResponsesComponent } from './responses-component';

/**
 * JSXEmitter generates React components to display API operation details
 * It returns JSX elements for path/query parameters, headers, request body, and responses
 */
export class JSXEmitter {
  #spec: OpenAPIObject;

  constructor(spec: OpenAPIObject) {
    this.#spec = spec;
  }

  /**
   * Main handle method to process an operation and return JSX components
   */
  handle(operation: TunedOperationObject): React.ReactNode {
    return (
      <div className="">
        {operation.description && (
          <div className="">{operation.description}</div>
        )}

        {operation.parameters.length > 0 && (
          <div className="space-y-6 mt-6">
            <ParametersComponent
              parameters={operation.parameters}
              type="path"
              spec={this.#spec}
            />

            <ParametersComponent
              parameters={operation.parameters}
              type="query"
              spec={this.#spec}
            />

            <ParametersComponent
              parameters={operation.parameters}
              type="header"
              spec={this.#spec}
            />
          </div>
        )}

        {operation.requestBody && (
          <RequestBodyComponent
            className="mt-6"
            requestBody={operation.requestBody}
            spec={this.#spec}
          />
        )}

        {operation.responses && (
          <ResponsesComponent
            className="mt-6"
            responses={operation.responses}
            spec={this.#spec}
          />
        )}
      </div>
    );
  }
}
