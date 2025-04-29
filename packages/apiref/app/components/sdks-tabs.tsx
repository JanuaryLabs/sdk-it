import type { ReactNode } from 'react';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '../shadcn/tabs';

interface SdkTab {
  name: string;
  value: string;
  content: ReactNode;
}

export default function SdksTabs({ tabs }: { tabs: SdkTab[] }) {
  return (
    <Tabs defaultValue={tabs[0].value} className="w-full">
      {/* use bg-muted/50 */}
      <TabsList className="w-full p-0 bg-background justify-start border-b rounded-none">
        {tabs.map((tab) => (
          <TabsTrigger
            key={tab.value}
            value={tab.value}
            className="rounded-none bg-background h-full data-[state=active]:shadow-none border border-transparent border-b-border data-[state=active]:border-border data-[state=active]:border-b-background -mb-[2px] rounded-t"
          >
            <code className="text-xs">{tab.name}</code>
          </TabsTrigger>
        ))}
      </TabsList>

      {tabs.map((tab) => (
        <TabsContent
          className="mt-0 border rounded-b border-t-0 p-1 bg-white"
          key={tab.value}
          value={tab.value}
        >
          {tab.content}
        </TabsContent>
      ))}
    </Tabs>
  );
}
