import ReactMarkdown from 'react-markdown';

import type {
  OperationEntry,
  TunedOperationObject,
} from '@sdk-it/spec/operation.js';

import { linkifyText } from './format-text';

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
    <div
      id={`operation-${operationId}`}
      className="rounded-lg border bg-card p-6 transition-colors hover:border-primary operation-card"
    >
      <div className="mb-4 flex items-center gap-3">
        <div
          className={`rounded px-2.5 py-0.5 text-xs font-medium method-badge method-${entry.method.toLowerCase()}`}
        >
          {entry.method.toUpperCase()}
        </div>
        <h4 className="text-lg font-semibold">
          {entry.name || operation.summary || operationId}
        </h4>
      </div>
      <div className="mb-3 font-mono text-sm text-gray-600">{entry.path}</div>

      {markdownDescription && (
        <div className="prose max-w-none text-sm">
          <ReactMarkdown>{markdownDescription}</ReactMarkdown>
        </div>
      )}
    </div>
  );
}
