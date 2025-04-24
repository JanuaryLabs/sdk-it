import type { TunedOperationObject } from '@sdk-it/spec/operation.js';
import type { CategoryItem } from '@sdk-it/spec/sidebar.js';

import { Separator } from '../shadcn/separator';
import { MD } from './md';
import { OperationCard } from './operation-card';
import type { AugmentedOperation } from './types';

interface OperationsListProps {
  sidebarData: CategoryItem[];
  operationsMap: Record<
    string,
    { entry: AugmentedOperation; operation: TunedOperationObject }
  >;
}

export function OperationsList({
  sidebarData,
  operationsMap,
}: OperationsListProps) {
  return (
    <div className="mx-auto max-w-6xl p-8 api-doc-content">
      {sidebarData.map((category) => (
        <div key={category.category} className="mb-12 api-doc-section">
          {/* <h2 className="mb-6 text-2xl font-bold">{category.category}</h2>
          <MD content={category.description} /> */}

          {category.items.map((group) => (
            <div key={group.title} className="mb-8 api-doc-section">
              <h3 className="mb-4 text-3xl font-semibold">{group.title}</h3>
              <MD content={group.description} />
              <Separator className="mt-12" />
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
