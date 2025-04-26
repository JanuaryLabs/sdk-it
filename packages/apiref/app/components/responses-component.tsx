import type {
  HeaderObject,
  OpenAPIObject,
  ReferenceObject,
  ResponseObject,
  ResponsesObject,
} from 'openapi3-ts/oas31';
import React, { Fragment, useState } from 'react';

import { followRef, isRef } from '@sdk-it/core';

import { cn } from '../shadcn/cn';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../shadcn/collapsible';
import { Separator } from '../shadcn/separator';
import { Description } from './description';
import { SchemaComponent } from './schema-component';

interface ResponseItemProps {
  statusCode: string;
  response: ResponseObject;
  spec: OpenAPIObject;
  collapsible?: boolean;
}

const ResponseItem: React.FC<ResponseItemProps> = ({
  statusCode,
  response,
  spec,
  collapsible = false,
}) => {
  const [expanded, setExpanded] = useState(false);
  const content = (
    <>
      {response.content &&
        Object.entries(response.content).map(([contentType, mediaType]) => (
          <div key={contentType} className="response-content-type">
            {mediaType.schema && (
              <div className="response-schema">
                <SchemaComponent schema={
                  isRef(mediaType.schema) ? followRef(spec, mediaType.schema.$ref) : mediaType.schema
                } />
              </div>
            )}
            {mediaType.example && (
              <div className="response-example">
                <h6>Example:</h6>
                <pre>{JSON.stringify(mediaType.example, null, 2)}</pre>
              </div>
            )}
          </div>
        ))}

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
                  <Description description={resolvedHeader.description} />
                  {resolvedHeader.schema && (
                    <SchemaComponent schema={resolvedHeader.schema} />
                  )}
                </div>
              );
            },
          )}
        </div>
      )}
    </>
  );

  if (collapsible) {
    return (
      <Collapsible
        open={expanded}
        onOpenChange={setExpanded}
        className="response-item"
      >
        <CollapsibleTrigger asChild>
          <h5 className={cn('text-sm cursor-pointer flex gap-x-2')}>
            <code>{statusCode}</code>
            <Description
              description={response.description}
              className={cn({
                'line-clamp-1': !expanded,
              })}
            />
          </h5>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2">{content}</CollapsibleContent>
      </Collapsible>
    );
  }

  return (
    <div className="response-item">
      <h5 className="response-status text-sm">
        <code>{statusCode}</code>
        <Description description={response.description} />
      </h5>
      {content}
    </div>
  );
};

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

  const entries = Object.entries(responses as Record<string, ResponseObject>);
  const single = entries.length === 1;

  return (
    <div className={className}>
      <h4 className="text-lg font-semibold">Returns</h4>
      <Separator className="my-4" />

      <div className="">
        {entries.map(([statusCode, response]) => (
          <Fragment key={statusCode}>
            <ResponseItem
              key={statusCode}
              statusCode={statusCode}
              response={response}
              spec={spec}
              collapsible={!single}
            />
            <Separator className="my-2" />
          </Fragment>
        ))}
      </div>
    </div>
  );
};
