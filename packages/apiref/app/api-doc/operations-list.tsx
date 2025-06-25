import { motion } from 'motion/react';
import { useEffect, useState } from 'react';

import { Description } from '../components/description';
import { Separator } from '../shadcn/separator';
import { useRootData } from '../use-root-data';
import { OperationCard } from './operation-card';

function useMounted() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  return mounted;
}

export function OperationsList() {
  const { sidebar, operationsMap } = useRootData();
  const mounted = useMounted();

  return (
    <div className="mx-auto p-10">
      {sidebar
        .filter((it) => it.id.startsWith('api'))
        .map((category) => (
          <div key={category.category} className="api-doc-section mb-12">
            {/* <h2 className="mb-6 text-2xl font-bold">{category.category}</h2>
          <MD content={category.description} /> */}

            {category.items.map((group) => (
              <div key={group.title} className="api-doc-section mb-8">
                <h3 className="mb-4 text-3xl font-semibold">{group.title}</h3>
                <Description
                  className="prose"
                  id={group.id}
                  description={group.description}
                />
                <Separator className="mt-12" />
                <div className="grid gap-6">
                  {group.items?.map((item) => {
                    const operationId = item.url.split('/').pop() || '';
                    const { entry, operation } = operationsMap[operationId];
                    return (
                      <motion.div
                        key={operationId}
                        id={operationId}
                        viewport={{
                          amount: 'some',
                          margin: '0px 0px -50% 0px',
                        }}
                        onViewportEnter={() => {
                          if (!mounted) return;
                          window.history.replaceState(
                            null,
                            '',
                            `${import.meta.env.BASE_URL}${item.url}`,
                          );
                        }}
                      >
                        <OperationCard
                          key={`${operationId}-card`}
                          entry={entry}
                          operation={operation}
                        />
                      </motion.div>
                    );
                  })}
                </div>
                <Separator className="mt-12" />
              </div>
            ))}
          </div>
        ))}
    </div>
  );
}
