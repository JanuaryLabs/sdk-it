import { type ReactNode, Suspense, useState } from 'react';

import codeSnippets, { Example } from './code-snippets';
import { AIV2 } from './components/ai';
import Background from './components/background';
import { CodeExamples, type CodeTab } from './components/code-examples';
import { Particles } from './components/particles';
import SpecBox from './components/spec-box';
import { TextGenerateEffect } from './components/text-generate-effect';
import { VercelTabs } from './components/vercel-tabs';
import { Button, EyeCatchingButton, cn } from './shadcn';

export function Hero(props: { className?: string }) {
  return (
    <div
      className={cn(
        'scroll-target mx-auto grid w-full snap-start grid-cols-4 items-start gap-2 md:gap-8 md:gap-y-2 lg:grid-cols-5 lg:grid-rows-[auto_auto_auto] lg:gap-12 lg:gap-y-0 xl:grid-cols-7',
        props.className,
      )}
    >
      <div className="col-span-full flex w-full flex-col items-center justify-center justify-self-center lg:col-span-3 lg:row-span-2 lg:items-start lg:justify-self-start xl:col-span-4">
        <h1 className="mb-8 font-sans md:font-mono">
          <TextGenerateEffect
            className="text-center text-3xl font-semibold text-balance lg:text-left lg:text-4xl"
            filter={false}
            duration={1.5}
            wordClassMap={{
              // developer: 'text-blue-700',
              // experience: 'text-green-700',
              // premium: 'text-green-700',
              OpenAPI: 'text-blue-700',
            }}
            words={'Turn your OpenAPI spec into premium developer experience'}
          />
        </h1>
        <h2 className="text-muted-foreground text-center leading-tight text-balance sm:text-lg lg:max-w-none lg:text-left">
          Cut costs, reduce maintenance, and boost productivity with type-safe
          client libraries, documentation, and agent tools — all generated
          automatically.
        </h2>
      </div>
      <div className="col-span-full inline-flex flex-col items-center justify-center gap-4 sm:flex-row lg:col-span-3 lg:row-start-3 lg:mb-0 lg:justify-start xl:col-span-4">
        <div className="mt-4 flex flex-col items-center gap-4 md:flex-row lg:gap-8">
          <Button size={'lg'}>
            <a href="/">Get started</a>
          </Button>
          <EyeCatchingButton>
            <a href="https://cal.com/january-sh/30min"> Request a demo </a>
          </EyeCatchingButton>
        </div>
      </div>
      <div className="col-span-full flex w-full justify-center lg:col-span-2 lg:col-start-4 lg:row-span-3 lg:justify-end lg:justify-self-start xl:col-span-3 xl:col-start-5">
        <SpecBoxDemo />
      </div>
    </div>
  );
}

const tabs: CodeTab[] = [
  {
    id: 'pagination',
    label: 'Pagination',
    description: 'Learn how to paginate through large datasets efficiently.',
  },
  {
    id: 'fileupload',
    label: 'File Upload',
    description: 'Learn how to upload files using the API.',
  },
  {
    id: 'streaming',
    label: 'Streaming',
    description: 'Learn how to stream data in real-time.',
  },
];
export default function App() {
  const a: Record<string, ReactNode> = {
    pagination: <Example key="pagination" snippet={codeSnippets.pagination} />,
    fileupload: <Example key="fileupload" snippet={codeSnippets.fileupload} />,
    streaming: <Example key="streaming" snippet={codeSnippets.streaming} />,
  };
  const [activeTab, setActiveTab] = useState(tabs[0].id);
  return (
    <Suspense>
      <Background className="relative mx-auto px-4 md:px-8 lg:px-8 xl:max-w-full xl:px-12 2xl:max-w-[1400px] 2xl:px-0 2xl:py-24">
        <Particles
          className="absolute inset-0"
          quantity={100}
          ease={30}
          color={'#000000'}
          refresh
        />
        <Hero />
        <CodeExamples
          className="mt-8"
          tabs={tabs}
          activeTab={activeTab}
          onTabChange={setActiveTab}
        >
          {a[activeTab]}
        </CodeExamples>
      </Background>
    </Suspense>
  );
}

export function SpecBoxDemo() {
  const [selectedTab, setSelectedTab] = useState('generate-sdk');
  return (
    <div className="z-10 w-full max-w-xl lg:max-w-none">
      <VercelTabs
        className="mb-4"
        tabs={[
          { label: 'Talk with Spec', id: 'ask-ai' },
          { label: 'Generate SDK', id: 'generate-sdk' },
          { label: 'Generate Docs', id: 'generate-docs' },
        ]}
        onTabChange={setSelectedTab}
      />
      <SpecBox />
      <AIV2 open={selectedTab === 'ask-ai'}>
        <div></div>
      </AIV2>
    </div>
  );
}

// export function Right() {
//   const [activeTab, setActiveTab] = useState<TabId>(tabs[0].id as TabId);
//   const [activeLanguage, setActiveLanguage] = useState<Language>('typescript');

//   return (
//     <div className="flex flex-col space-y-4 w-full">
//       <VercelTabs
//         tabs={tabs}
//         onTabChange={(tabId: string) => setActiveTab(tabId as TabId)}
//       />
//       <div className="border rounded p-px">
//         <EditorTabs
//           className="border-b bg-muted/50"
//           activeLanguage={activeLanguage}
//           setActiveLanguage={(lang) => setActiveLanguage(lang as Language)}
//         />
//         <div className="h-[40vh]">
//           <Editor
//             readonly={true}
//             language={activeLanguage}
//             value={codeSnippets[activeTab][activeLanguage]}
//           />
//         </div>
//       </div>
//     </div>
//   );
// }
