/* eslint-disable @nx/enforce-module-boundaries */
import { ChevronDown } from 'lucide-react';
import type {
  HeaderObject,
  ReferenceObject,
  ResponseObject,
  ResponsesObject,
} from 'openapi3-ts/oas31';
import React, { Fragment, useState } from 'react';

import { followRef, isRef, resolveRef } from '@sdk-it/core/ref.js';
import { isEmpty } from '@sdk-it/core/utils.js';

import { cn } from '../shadcn/cn';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../shadcn/collapsible';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../shadcn/dropdown-menu';
import { Separator } from '../shadcn/separator';
import { useRootData } from '../use-root-data';
import { Description } from './description';
import { SchemaComponent, getTypeDisplay } from './schema-component';

interface ResponseTypesProps {
  contentTypes: string[];
  selectedContentType: string | null;
  setSelectedContentType: (contentType: string) => void;
}

const ContentTypeDropdown: React.FC<ResponseTypesProps> = ({
  contentTypes,
  selectedContentType,
  setSelectedContentType,
}) => {
  // If there is only one content type, just render it without a dropdown
  if (contentTypes.length === 1) {
    return (
      <span className="text-muted-foreground text-xs">{contentTypes[0]}</span>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs">
        {selectedContentType}
        <ChevronDown className="h-3 w-3" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {contentTypes.map((contentType) => (
          <DropdownMenuItem
            key={contentType}
            onClick={() => setSelectedContentType(contentType)}
            className={cn(
              'text-xs',
              contentType === selectedContentType && 'font-medium',
            )}
          >
            {contentType}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

interface ResponseContentProps {
  response: ResponseObject;
  selectedContentType: string | null;
}

const ResponseContent: React.FC<ResponseContentProps> = ({
  response,
  selectedContentType,
}) => {
  const { spec } = useRootData();
  if (
    !selectedContentType ||
    !response.content ||
    !response.content[selectedContentType]
  ) {
    return null;
  }

  return (
    <>
      {response.content[selectedContentType].schema && (
        <SchemaComponent
          hideType={(level) => level === 0}
          schema={resolveRef(
            spec,
            response.content[selectedContentType].schema,
          )}
        />
      )}
      {response.content[selectedContentType].example && (
        <div>
          <h6>Example:</h6>
          <pre>
            {JSON.stringify(
              response.content[selectedContentType].example,
              null,
              2,
            )}
          </pre>
        </div>
      )}

      {response.headers && Object.keys(response.headers).length > 0 && (
        <div className="response-headers">
          <h6>Headers:</h6>
          {Object.entries(response.headers).map(
            ([headerName, maybeHeaderObj]) => {
              const headerObj = resolveRef<HeaderObject | ReferenceObject>(
                spec,
                maybeHeaderObj,
              );
              const headerSchema = resolveRef<HeaderObject>(spec, headerObj);
              return (
                <div key={headerName} className="response-header">
                  <code>{headerName}</code>
                  <Description description={headerSchema.description} />
                  {headerSchema.schema && (
                    <SchemaComponent schema={headerSchema.schema} />
                  )}
                </div>
              );
            },
          )}
        </div>
      )}
    </>
  );
};

interface ResponseItemProps {
  statusCode: string;
  response: ResponseObject;
  collapsible?: boolean;
}

const ResponseItem: React.FC<ResponseItemProps> = ({
  statusCode,
  response,
  collapsible = false,
}) => {
  const contentTypes = Object.keys(response.content ?? {});
  const [selectedContentType, setSelectedContentType] = useState<string | null>(
    contentTypes[0] ?? null,
  );
  const [expanded, setExpanded] = useState(false);

  const hasMultipleContentTypes = contentTypes.length > 1;

  if (collapsible) {
    return (
      <Collapsible
        open={expanded}
        onOpenChange={setExpanded}
        className="response-item"
      >
        <CollapsibleTrigger asChild>
          <h5 className={cn('flex cursor-pointer gap-x-2 text-sm')}>
            <code>{statusCode}</code>
            <Description
              description={response.description}
              className={cn({
                'line-clamp-1': !expanded,
              })}
            />
          </h5>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2">
          {hasMultipleContentTypes && (
            <ContentTypeDropdown
              contentTypes={contentTypes}
              selectedContentType={selectedContentType}
              setSelectedContentType={setSelectedContentType}
            />
          )}
          <ResponseContent
            response={response}
            selectedContentType={selectedContentType}
          />
        </CollapsibleContent>
      </Collapsible>
    );
  }

  return (
    <div className="response-item">
      <div className="flex items-center justify-between gap-x-1">
        <h5
          className={cn(
            'flex cursor-pointer flex-wrap items-center gap-x-1 text-sm',
          )}
        >
          <code>{statusCode}</code>
          <Type response={response} selectedContentType={selectedContentType} />
          <Description description={response.description} />
        </h5>
        {hasMultipleContentTypes && (
          <ContentTypeDropdown
            contentTypes={contentTypes}
            selectedContentType={selectedContentType}
            setSelectedContentType={setSelectedContentType}
          />
        )}
      </div>
      <ResponseContent
        response={response}
        selectedContentType={selectedContentType}
      />
    </div>
  );
};

function Type({
  response,
  selectedContentType,
}: {
  response: ResponseObject;
  selectedContentType: string | null;
}) {
  const { spec } = useRootData();
  if (
    !selectedContentType ||
    !response.content ||
    !response.content[selectedContentType] ||
    !response.content[selectedContentType].schema
  ) {
    return null;
  }
  const schema = isRef(response.content[selectedContentType].schema)
    ? followRef(spec, response.content[selectedContentType].schema.$ref)
    : response.content[selectedContentType].schema;
  return (
    <span className="text-muted-foreground text-xs">
      {getTypeDisplay(schema)}
    </span>
  );
}

interface StatusesDropdownProps {
  statusCodes: string[];
  value: string;
  onChange: (statusCode: string) => void;
}

const StatusesDropdown: React.FC<StatusesDropdownProps> = ({
  statusCodes,
  value,
  onChange,
}) => {
  if (statusCodes.length === 1) {
    return (
      <div className="text-muted-foreground text-xs">
        <code>{value}</code>
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs">
        <code>{value}</code>
        <ChevronDown className="h-3 w-3" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {statusCodes.map((statusCode) => (
          <DropdownMenuItem
            key={statusCode}
            onClick={() => onChange(statusCode)}
            className={cn('text-xs', statusCode === value && 'font-medium')}
          >
            <code>{statusCode}</code>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

interface ResponsesComponentProps {
  responses: ResponsesObject;
  className?: string;
  /**
   * Renders the responses in a compact layout
   * @if {false} render status codes in dropdown.
   * @if {true} render each status code in a collapsible section.
   */
  compact?: boolean;
}

interface CompactModeProps {
  responses: ResponsesObject;
}

function CompactMode({ responses }: CompactModeProps) {
  const entries = Object.entries(responses as Record<string, ResponseObject>);
  const statusCodes = entries.map(([code]) => code);
  const [selectedStatusCode, setSelectedStatusCode] = useState<string>(
    statusCodes[0] || '',
  );

  const selectedResponse = responses[selectedStatusCode] as ResponseObject;
  const contentTypes = selectedResponse?.content
    ? Object.keys(selectedResponse.content)
    : [];
  const [selectedContentType, setSelectedContentType] = useState<string | null>(
    contentTypes[0] ?? null,
  );

  return (
    <div>
      <div className="flex items-center justify-between">
        <h4 className="text-lg font-semibold">Returns</h4>
        <div className="flex items-center gap-2">
          <StatusesDropdown
            statusCodes={statusCodes}
            value={selectedStatusCode}
            onChange={setSelectedStatusCode}
          />
          <ContentTypeDropdown
            contentTypes={
              contentTypes.length > 0 ? contentTypes : ['Not specified']
            }
            selectedContentType={selectedContentType}
            setSelectedContentType={setSelectedContentType}
          />
        </div>
      </div>

      <div className="space-y-1">
        {selectedResponse && (
          <ResponseContent
            response={selectedResponse}
            selectedContentType={selectedContentType}
          />
        )}
      </div>
    </div>
  );
}

interface CollapsibleModeProps {
  responses: ResponsesObject;
}

function CollapsibleMode({ responses }: CollapsibleModeProps) {
  const entries = Object.entries(responses as Record<string, ResponseObject>);
  const single = entries.length === 1;

  return (
    <div>
      <h4 className="text-lg font-semibold">Returns</h4>

      <Separator className="my-4" />

      <div className="space-y-1">
        {entries.map(([statusCode, response], index) => (
          <Fragment key={statusCode}>
            {index > 0 && <Separator className="my-4" />}
            <ResponseItem
              statusCode={statusCode}
              response={response}
              collapsible={!single}
            />
          </Fragment>
        ))}
      </div>
    </div>
  );
}

export const ResponsesComponent: React.FC<ResponsesComponentProps> = ({
  responses,
  className,
  compact = true,
}) => {
  if (isEmpty(responses)) {
    return null;
  }

  return (
    <div className={className}>
      {compact ? (
        <CompactMode responses={responses} />
      ) : (
        <CollapsibleMode responses={responses} />
      )}
    </div>
  );
};
