import { useMemo } from 'react';

import type { TunedOperationObject } from '@sdk-it/spec/operation.js';

import { JSXEmitter } from '../components/jsx-emitter';
import { EditorTabs } from '../components/sdks-tabs';
import { Badge } from '../shadcn/badge';
import { cn } from '../shadcn/cn';
import { useSpec } from '../spec-context';
import { MD } from './md';
import type { AugmentedOperation } from './types';

interface OperationCardProps {
  entry: AugmentedOperation;
  operation: TunedOperationObject;
  className?: string;
}

export function OperationCard({
  entry,
  operation,
  className,
}: OperationCardProps) {
  const { spec } = useSpec();

  const operationContent = useMemo(
    () => new JSXEmitter(spec).handle(operation),
    [operation, spec],
  );

  const tabsConfig = useMemo(() => {
    return entry.snippets.map((snippet) => ({
      name: snippet.language,
      value: snippet.language,
      content: (
        <MD
          id={`${operation.operationId}-${snippet.language}`}
          content={snippet.code}
        />
      ),
    }));
  }, [entry.snippets, operation.operationId]);

  return (
    <div className={cn('pt-12', className)}>
      <span className="text-3xl font-semibold">
        {entry.name || operation.operationId}
      </span>
      <div className="grid grid-cols-[55%_minmax(0,100%)] items-start gap-x-8">
        <div id="left" className="sticky top-0 self-start">
          <div className="my-4 flex items-center">
            <Badge variant={'secondary'} className="gap-x-1 py-1">
              <span className="font-mono">{entry.method.toUpperCase()}</span>
              <span className="font-normal">{entry.path}</span>
            </Badge>
          </div>

          <div className="prose max-w-none text-sm">
            <MD id={operation.operationId} content={operation.summary}></MD>
          </div>

          <div>{operationContent}</div>
        </div>

        <div id="right" className="h-full self-start rounded">
          <EditorTabs
            className="bg-muted/50 border border-b"
            tabs={tabsConfig}
          />
        </div>
      </div>
    </div>
  );
}
