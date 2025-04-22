import ReactMarkdown from 'react-markdown';

import type {
  OperationEntry,
  TunedOperationObject,
} from '@sdk-it/spec/operation.js';

import { Badge } from '../shadcn/badge';
import { linkifyText } from './format-text';
import { MD } from './md';

interface OperationCardProps {
  entry: OperationEntry;
  operation: TunedOperationObject;
  operationId: string;
}

export function OperationCard({
  entry,
  operation,
  operationId,
}: OperationCardProps) {
  // Apply linkification to the entire description
  const markdownDescription = operation.description
    ? linkifyText(operation.description)
    : '';

  return (
    <div id={operationId}>
      <span className="text-3xl font-semibold">
        {entry.name || operationId}
      </span>
      <div className="my-4 flex items-center">
        <Badge variant={'secondary'} className="gap-x-1 py-1">
          <span className="font-mono">{entry.method.toUpperCase()}</span>
          <span>{entry.path}</span>
        </Badge>
      </div>

      <div className="prose max-w-none text-sm">
        <MD content={operation.summary}></MD>
      </div>
    </div>
  );
}
