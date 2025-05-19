import { type ReactNode, Suspense, useState } from 'react';
import { useReadLocalStorage } from 'usehooks-ts';

import type { PostPlaygroundOutput200 } from '@sdk-it/client';

import codeSnippets, { Example } from './code-snippets';
import Background from './components/background';
import { CodeExamples, type CodeTab } from './components/code-examples';
import { Particles } from './components/particles';
import SpecBox from './components/spec-box';
import { TextGenerateEffect } from './components/text-generate-effect';
import { Button, EyeCatchingButton, cn } from './shadcn';
import {
  Credenza,
  CredenzaBody,
  CredenzaContent,
  CredenzaDescription,
  CredenzaHeader,
  CredenzaTitle,
  CredenzaTrigger,
} from './shadcn/lib/ui/credenza';

export function Hero(props: { className?: string }) {
  return (
    <div
      className={cn(
        'scroll-target mx-auto grid w-full snap-start grid-cols-4 items-start gap-2 md:gap-8 md:gap-y-2 lg:grid-cols-7 lg:grid-rows-[auto_auto] lg:gap-12 lg:gap-y-0',
        props.className,
      )}
    >
      <div className="col-span-full flex w-full flex-col items-center justify-center justify-self-center lg:col-span-4 lg:row-span-1 lg:items-start lg:justify-self-start">
        <h1 className="mb-4 font-sans md:font-mono">
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
        <h2 className="text-muted-foreground mb-6 text-center leading-tight text-balance sm:text-lg lg:max-w-none lg:text-left">
          Cut costs, reduce maintenance, and boost productivity with type-safe
          client libraries, documentation, and agent tools — all generated
          automatically.
        </h2>
      </div>
      <div className="col-span-full inline-flex flex-col items-center justify-center gap-4 sm:flex-row lg:col-span-3 lg:row-start-2 lg:mb-0 lg:justify-start xl:col-span-4">
        <div className="flex flex-col items-center gap-4 md:flex-row lg:gap-8">
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
    description:
      'Fetch large lists efficiently with cursor- or offset-based pagination.',
  },
  {
    id: 'fileupload',
    label: 'File Upload',
    description:
      'Upload files via multipart/form-data with built-in progress tracking.',
  },
  {
    id: 'streaming',
    label: 'Streaming',
    description:
      'Stream large payloads or real-time data without blocking the main thread.',
  },
  {
    id: 'sse',
    label: 'Server-Sent Events',
    description:
      'Subscribe to real-time server push events with automatic reconnection.',
  },
];

export default function App() {
  const sdkInfo = useReadLocalStorage<PostPlaygroundOutput200 | null>(
    'ts-sdk-info',
  ) ?? {
    url: '',
    name: '@scope/client',
    title: '',
    clientName: 'Client',
  };
  const a: Record<string, ReactNode> = {
    pagination: (
      <Example key="pagination" snippet={codeSnippets.pagination(sdkInfo)} />
    ),
    fileupload: (
      <Example key="fileupload" snippet={codeSnippets.fileupload(sdkInfo)} />
    ),
    streaming: (
      <Example key="streaming" snippet={codeSnippets.streaming(sdkInfo)} />
    ),
    sse: <Example key="sse" snippet={codeSnippets.streaming(sdkInfo)} />,
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
  const [open, setOpen] = useState(false);
  const [sdkInfo, setSdkInfo] = useState<PostPlaygroundOutput200 | undefined>();
  return (
    <div className="z-10 w-full max-w-xl lg:max-w-none">
      <SpecBox
        onGenerate={(info) => {
          setOpen(true);
          setSdkInfo(info);
        }}
      />
      <Credenza open={open} onOpenChange={setOpen}>
        <CredenzaTrigger asChild>
          <div></div>
        </CredenzaTrigger>
        <CredenzaContent className="h-screen max-h-[calc(100dvh)] max-w-screen min-w-full gap-0 rounded-none p-0">
          {/* <CredenzaHeader>
            <CredenzaTitle>Ask AI</CredenzaTitle>
            <CredenzaDescription>
              Hi! I'm an AI assistant trained on documentation, code, and other
              content. I can answer questions about{' '}
              <span className="text-foreground font-bold">SDK-IT</span>, what's
              on your mind?
            </CredenzaDescription>
          </CredenzaHeader> */}
          <CredenzaBody>
            <iframe
              title="Embedded Content"
              width="100%"
              style={{ height: '100%' }}
              src={`http://localhost:3002/embed?spec=${sdkInfo?.url}`}
              frameBorder="0"
              allowFullScreen
            ></iframe>
          </CredenzaBody>
        </CredenzaContent>
      </Credenza>

      {/* <VercelTabs
        className="mb-4"
        tabs={[
          { label: 'Talk with Spec', id: 'ask-ai' },
          { label: 'Generate SDK', id: 'generate-sdk' },
          { label: 'Generate Docs', id: 'generate-docs' },
        ]}
        onTabChange={setSelectedTab}
      />
      <SpecBox />
      <AI open={selectedTab === 'ask-ai'}>
        <div></div>
      </AI> */}
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
