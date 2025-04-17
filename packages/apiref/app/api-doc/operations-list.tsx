import type {
  OperationEntry,
  TunedOperationObject,
} from '@sdk-it/spec/operation.js';

import { Separator } from '../shadcn/separator';
import type { CategoryItem } from '../sidebar/nav';
import { MD } from './md';
import { OperationCard } from './operation-card';

interface OperationsListProps {
  sidebarData: CategoryItem[];
  operationsMap: Record<
    string,
    { entry: OperationEntry; operation: TunedOperationObject }
  >;
}

export function OperationsList({
  sidebarData,
  operationsMap,
}: OperationsListProps) {
  return (
    <div className="mx-auto max-w-5xl p-8 api-doc-content">
      {sidebarData.map((category) => (
        <div key={category.category} className="mb-12 api-doc-section">
          {/* <h2 className="mb-6 text-2xl font-bold">{category.category}</h2>
          <MD content={category.description} /> */}

          {category.items.map((group) => (
            <div key={group.title} className="mb-8 api-doc-section">
              <h3 className="mb-4 text-3xl font-semibold">{group.title}</h3>
              <MD content={group.description} />
              <Separator className="my-16" />
              <div className=" grid gap-6">
                {group.items?.map((item) => {
                  const operationId = item.url.split('/').pop() || '';
                  const { entry, operation } = operationsMap[operationId];
                  return (
                    <OperationCard
                      key={operationId}
                      entry={entry}
                      operationId={operationId}
                      operation={operation}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
