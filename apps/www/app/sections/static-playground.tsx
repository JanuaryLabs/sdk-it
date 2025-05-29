import { useState } from 'react';
import { titlecase } from 'stringcase';

import { Example } from '../code-snippets';
import { Safari } from '../components/safari';
import { TreeView } from '../components/tree';
import { cn } from '../shadcn';
import { useRootData } from '../use-root-data';

export function StaticPlayground(props: {
  frame?: boolean;
  className?: string;
}) {
  const { operations: data } = useRootData();

  const [activeTab, setActiveTab] =
    useState<keyof typeof data>('basic/TypeSafety');

  const treeData = Object.entries(data).reduce(
    (acc, [key, value]) => {
      const [folderName, file] = key.split('/');
      const folder = titlecase(folderName);
      acc[folder] ??= {
        id: folder,
        type: 'folder' as const,
        name: folder,
        children: [],
      };

      acc[folder].children.push({
        id: key,
        type: 'file' as const,
        name: value.title || file,
        value: value,
      });

      return acc;
    },
    {} as Record<string, any>,
  );

  const currentData: any = data[activeTab];

  const currentSnippet = {
    typescript: currentData.typescript,
    dart: '', // Add dart support when available
    spec: currentData.spec,
  };
  return (
    <div className={cn('w-full', props.className)}>
      {props.frame ? <Safari className="h-auto w-full" /> : null}
      <div className="relative grid w-full grid-cols-1 gap-x-4 xl:gap-0 lg:grid-cols-7 lg:gap-12 xl:grid-cols-4">
        <div className="col-span-full px-2 py-2 lg:col-span-2 xl:col-span-1">
          <TreeView
            onLeafSelect={(item) => {
              setActiveTab(item.id as keyof typeof data);
            }}
            selectedId={activeTab}
            data={Object.values(treeData)}
          />
        </div>
        <div className="col-span-full lg:col-start-3 xl:col-start-2">
          <Example className="lg:border-l" snippet={currentSnippet} />
        </div>
      </div>
    </div>
  );
}
