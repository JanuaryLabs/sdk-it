import type { TunedOperationObject } from '@sdk-it/spec/operation.js';

import { JSXEmitter } from '../components/jsx-emitter';
import SdksTabs from '../components/sdks-tabs';
import { Badge } from '../shadcn/badge';
import { useSpec } from '../spec-context';
import { MD } from './md';
import type { AugmentedOperation } from './types';

interface OperationCardProps {
  entry: AugmentedOperation;
  operation: TunedOperationObject;
  operationId: string;
}

export function OperationCard({
  entry,
  operation,
  operationId,
}: OperationCardProps) {
  const { spec } = useSpec();
  const jsxEmitter = new JSXEmitter(spec);

  return (
    <div id={operationId} className="grid grid-cols-2 items-start gap-x-8">
      <div id="left" className="sticky top-0 self-start pt-12">
        <span className="text-3xl font-semibold">
          {entry.name || operationId}
        </span>
        <div className="my-4 flex items-center">
          <Badge variant={'secondary'} className="gap-x-1 py-1">
            <span className="font-mono">{entry.method.toUpperCase()}</span>
            <span className="font-normal">{entry.path}</span>
          </Badge>
        </div>

        <div className="prose max-w-none text-sm">
          <MD content={operation.summary}></MD>
        </div>

        <div>{jsxEmitter.handle(operation)}</div>
      </div>

      <div id="right" className="sticky top-0 self-start pt-12">
        <SdksTabs
          tabs={entry.snippets.map((snippet) => ({
            name: snippet.language,
            value: snippet.language,
            content: <MD content={snippet.code} />,
          }))}
        />
      </div>
    </div>
  );
}
