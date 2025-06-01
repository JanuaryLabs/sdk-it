import { BookText, CodeSquare, Sparkles, WandSparkles } from 'lucide-react';
import { useState } from 'react';

import { useTheme } from '../components/toggle-theme';
import { cn } from '../shadcn';
import { AskAi } from './ai';
import { StaticPlayground } from './static-playground';

const tabs = [
  {
    id: 'sdks',
  },
  {
    id: 'docs',
  },
  {
    id: 'askai',
  },
  {
    id: 'outlyne',
  },
];

const demoData = {
  sdks: {
    title: 'Sdks',
    subtitle: 'Well-crafted SDKs',
    description:
      'Fun fact: LiveStore was originally developed as a part of Overtone and later factored out.',
    icon: CodeSquare,
  },
  docs: {
    title: 'API Docs',
    subtitle: 'Intuitive API documentation',
    icon: BookText,
  },
  askai: {
    title: 'Ask AI',
    subtitle: 'AI Chat tailored to your API',
    icon: WandSparkles,
  },
  outlyne: {
    title: 'API Agent Editor',
    subtitle: 'Customize your API spec',
    icon: Sparkles,
  },
};

export const Demos = () => {
  const [activeDemo, setActiveDemo] = useState<keyof typeof demoData>('sdks');
  const { theme } = useTheme();
  const spec =
    'https://gist.githubusercontent.com/ezzabuzaid/14bc73e2a230f00b61df56779e5cad32/raw/82ef19f4faf82a745f16d2f22f67b9fc79aceb65/oto.postman.json';
  return (
    <div className="w-full overflow-hidden rounded border">
      <div className="flex w-full items-stretch overflow-x-auto overflow-y-hidden lg:grid lg:grid-cols-4 lg:overflow-visible">
        {tabs.map((tab, index) => {
          const demo = demoData[tab.id as keyof typeof demoData];
          const isActive = activeDemo === tab.id;
          const IconComponent = demo.icon;

          const first = index === 0;
          return (
            <button
              key={tab.id}
              className={cn(
                !first ? 'border-l' : '',
                'flex cursor-pointer items-center gap-3 border-b p-5 text-left transition-colors focus:outline-none',
                isActive
                  ? 'border-b-orange-500 bg-neutral-50 dark:bg-white/5'
                  : 'hover:bg-neutral-50 dark:hover:bg-neutral-900',
                isActive && 'hover:border-b-orange-500', // Preserve active border on hover
              )}
              onClick={() => setActiveDemo(tab.id as keyof typeof demoData)}
              tabIndex={0}
              aria-label={`View ${demo.title} demo`}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setActiveDemo(tab.id as keyof typeof demoData);
                }
              }}
            >
              <div className="flex size-10 shrink-0 items-center justify-center xl:size-12">
                <IconComponent
                  className={cn(
                    'size-6',
                    isActive ? 'text-foreground' : 'text-muted-foreground',
                  )}
                />
              </div>
              <div className="whitespace-nowrap">
                <div
                  className={cn(
                    'font-medium',
                    isActive ? 'text-foreground' : 'text-muted-foreground',
                  )}
                >
                  {demo.title}
                </div>
                <div className="text-muted-foreground text-sm">
                  {demo.subtitle}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <div className="flex flex-col items-center gap-12 focus:outline-none">
        {activeDemo === 'sdks' ? (
          <StaticPlayground />
        ) : activeDemo === 'docs' ? (
          <iframe
            title="Embedded Content"
            width="100%"
            className="size-full min-h-svh"
            src={`http://localhost:4202/embed?theme=${theme}&spec=${spec}`}
            allowFullScreen
            loading="eager"
          ></iframe>
        ) : activeDemo === 'askai' ? (
          <AskAi className="min-h-52 overflow-auto px-4" spec={spec} />
        ) : (
          <></>
        )}
      </div>
    </div>
  );
};
