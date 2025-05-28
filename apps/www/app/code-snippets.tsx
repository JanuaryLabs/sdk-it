import { type ReactNode, useState } from 'react';
import { BiLogoFlutter, BiLogoTypescript } from 'react-icons/bi';
import { SiOpenapiinitiative } from 'react-icons/si';

import {
  ScrollArea,
  ScrollBar,
  Tabs,
  TabsList,
  TabsTrigger,
  cn,
} from './shadcn';

type SdkInfo = {
  url: string;
  title: string;
  name: string;
  clientName: string;
};

export function Example(props: {
  snippet: Record<string, string>;
  className?: string;
  height?: string;
}) {
  const iconToLanguage: Record<string, ReactNode> = {
    typescript: <BiLogoTypescript size={20} />,
    dart: <BiLogoFlutter size={20} />,
    spec: <SiOpenapiinitiative size={20} />,
  };
  const availableLanguages = Object.keys(props.snippet).map((lang) => ({
    lang,
    content: props.snippet[lang],
    icon: iconToLanguage[lang] || null,
  }));
  const [activeLanguage, setActiveLanguage] = useState<string>(
    availableLanguages[0].lang,
  );

  return (
    <div className={cn('h-full', props.className)}>
      <EditorTabs
        className="border-b"
        activeLanguage={activeLanguage}
        setActiveLanguage={(lang) => setActiveLanguage(lang)}
        availableLanguages={availableLanguages}
      />
      <div
        className={cn(
          'max-h-96 lg:h-[calc(100%-37px)] lg:max-h-full lg:min-h-[51vh]',
          {
            'overflow-auto': activeLanguage === 'spec',
          },
        )}
      >
        <div
          className={cn('h-full min-w-full', {
            prose: activeLanguage === 'spec',
          })}
          dangerouslySetInnerHTML={{
            __html: props.snippet[activeLanguage] || '',
          }}
        ></div>
      </div>
    </div>
  );
}

interface EditorTabsProps {
  activeLanguage: string;
  setActiveLanguage: (language: string) => void;
  className?: string;
  availableLanguages: {
    content: string;
    icon: ReactNode;
    lang: string;
  }[];
}

function EditorTabs({
  activeLanguage,
  setActiveLanguage,
  className,
  availableLanguages,
}: EditorTabsProps) {
  return (
    <Tabs value={activeLanguage} onValueChange={setActiveLanguage}>
      <ScrollArea>
        <TabsList
          className={cn(
            'bg-background h-auto w-full justify-start -space-x-px rounded-none p-0 rtl:space-x-reverse',
            className,
          )}
        >
          {/*  data-[state=active]:after:bg-primary */}
          {availableLanguages.map((it) => (
            <TabsTrigger
              key={it.lang}
              value={it.lang}
              className="data-[state=active]:bg-muted relative min-w-32 cursor-pointer gap-x-1 overflow-hidden rounded-none py-2 capitalize after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 data-[state=active]:shadow-none"
            >
              {it.icon}
              {it.lang}
            </TabsTrigger>
          ))}
          {/* {availableLanguages.includes('typescript') && (
            <TabsTrigger
              value="typescript"
              className="data-[state=active]:bg-muted relative gap-x-1 overflow-hidden rounded-none py-2 after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 data-[state=active]:shadow-none"
            >
              <BiLogoTypescript size={20} />
              TypeScript
            </TabsTrigger>
          )}
          {availableLanguages.includes('dart') && (
            <TabsTrigger
              value="dart"
              className="data-[state=active]:bg-muted relative gap-x-1 overflow-hidden rounded-none py-2 after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 data-[state=active]:shadow-none"
            >
              <BiLogoFlutter size={20} />
              Dart
            </TabsTrigger>
          )}
          {availableLanguages.includes('spec') && (
            <TabsTrigger
              value="spec"
              className="data-[state=active]:bg-muted data-[state=active]:after:bg-primary relative gap-x-1 overflow-hidden rounded-none py-2 after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 data-[state=active]:shadow-none"
            >
              <SiOpenapiinitiative size={20} />
              Spec
            </TabsTrigger>
          )} */}
        </TabsList>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
    </Tabs>
  );
}
