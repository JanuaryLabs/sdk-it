import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@zukhruf/shadcn';
import { cn } from 'cn';
import { ChevronDown } from 'lucide-react';
import type {
  HeaderObject,
  ReferenceObject,
  ResponseObject,
  ResponsesObject,
} from 'openapi3-ts/oas31';
import React, { useState } from 'react';

import { resolveRef } from '@sdk-it/core/ref.js';
import { isEmpty } from '@sdk-it/core/utils.js';

import { useRootData } from '../use-root-data';
import { Description } from './description';
import { SchemaComponent } from './schema-component';

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

export const ResponsesComponent: React.FC<ResponsesComponentProps> = ({
  responses,
  className,
}) => {
  if (isEmpty(responses)) {
    return null;
  }

  return (
    <div className={className}>
      <CompactMode responses={responses} />
    </div>
  );
};
