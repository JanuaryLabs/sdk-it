import {
  ScrollArea,
  ScrollBar,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@zukhruf/shadcn';
import { cn } from 'cn';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { BiLogoFlutter, BiLogoTypescript } from 'react-icons/bi';
import { SiAiohttp, SiOpenapiinitiative } from 'react-icons/si';

interface SdkTab {
  name: string;
  value: string;
  content: ReactNode;
}

export default function SdksTabs({ tabs }: { tabs: SdkTab[] }) {
  return (
    <Tabs defaultValue={tabs[0].value} className="w-full">
      {/* use bg-muted/50 */}
      <TabsList className="bg-background w-full justify-start rounded-none border-b p-0">
        {tabs.map((tab) => (
          <TabsTrigger
            key={tab.value}
            value={tab.value}
            className="bg-background border-b-border data-active:border-border data-active:border-b-background -mb-[2px] h-full rounded-none rounded-t border border-transparent data-active:shadow-none"
          >
            <code className="text-xs">{tab.name}</code>
          </TabsTrigger>
        ))}
      </TabsList>

      {tabs.map((tab) => (
        <TabsContent
          className="mt-0 rounded-b border border-t-0 bg-white p-1"
          key={tab.value}
          value={tab.value}
        >
          {tab.content}
        </TabsContent>
      ))}
    </Tabs>
  );
}

export const langIconMap = {
  typescript: <BiLogoTypescript size={20} />,
  dart: <BiLogoFlutter size={20} />,
  spec: <SiOpenapiinitiative size={20} />,
  curl: <SiAiohttp size={20} />,
};

export function EditorTabs({
  tabs,
  className,
}: {
  className?: string;
  tabs: SdkTab[];
}) {
  const [activeLanguage, setActiveLanguage] = useState(tabs[0].value);
  return (
    <Tabs value={activeLanguage} onValueChange={setActiveLanguage}>
      <ScrollArea>
        <TabsList
          variant="line"
          className={cn(
            'bg-background h-auto w-full justify-start -space-x-px rounded-none p-0 rtl:space-x-reverse',
            className,
          )}
        >
          {tabs.map((tab) => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              className="data-active:after:bg-primary relative gap-x-1 overflow-hidden rounded-none py-2 after:pointer-events-none after:absolute after:inset-x-0 after:h-0.5 group-data-horizontal/tabs:after:bottom-0 data-active:bg-inherit data-active:shadow-none dark:text-white dark:data-active:text-[#99FFE4]"
            >
              {langIconMap[tab.value as keyof typeof langIconMap]}
              <code className="text-xs">{tab.name}</code>
            </TabsTrigger>
          ))}
        </TabsList>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
      {tabs.map((tab) => (
        <TabsContent
          className="mt-0 rounded-b border border-t-0 text-sm"
          key={tab.value}
          value={tab.value}
        >
          {tab.content}
        </TabsContent>
      ))}
    </Tabs>
  );
}
