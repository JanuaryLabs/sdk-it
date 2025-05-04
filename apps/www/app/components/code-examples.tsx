import { type ReactNode } from 'react';

import { cn } from '../shadcn';

export type CodeTab = {
  id: string;
  label: string;
  description: string;
};

type CodeExamplesProps<T extends CodeTab> = {
  tabs: T[];
  activeTab: string;
  onTabChange?: (tabId: string) => void;
  children: ReactNode;
  className?: string;
};

export function CodeExamples<T extends CodeTab>({
  tabs,
  onTabChange,
  children,
  className,
  activeTab,
}: CodeExamplesProps<T>) {
  // const [activeTab, setActiveTab] = useState(props.activeTab);

  // const handleTabChange = (tabId: string) => {
  //   if (onTabChange) {
  //     onTabChange(tabId);
  //   } else {
  //     setActiveTab(tabId);
  //   }
  // };

  return (
    <div className={cn('w-full', className)}>
      <div className="relative grid grid-cols-1 gap-12 md:grid-cols-5">
        {/* Tabs - Left Side */}
        <div className="bg-background sticky top-[var(--header-height)] border-b md:col-span-2 md:border-b-0">
          <div className="feature-btn-container flex overflow-x-auto md:flex-col">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => {
                  onTabChange?.(tab.id);
                  // setActiveTab(tab.id);
                }}
                className={cn(
                  'border-border hover:bg-muted/50 mr-2 w-64 flex-shrink-0 cursor-pointer rounded border p-4 text-left not-last:mb-2 last:mr-0 md:mr-0 md:w-full',
                  activeTab === tab.id && 'bg-accent/70',
                )}
              >
                <h3 className="font-medium tracking-tight">{tab.label}</h3>
                <p className="text-muted-foreground text-sm">
                  {tab.description}
                </p>
              </button>
            ))}
          </div>
        </div>

        <div className="col-span-1 md:col-span-3">{children}</div>
      </div>
    </div>
  );
}
