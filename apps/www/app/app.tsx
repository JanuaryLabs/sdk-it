import { useState } from 'react';
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

import { titlecase } from 'stringcase';
import { useReadLocalStorage } from 'usehooks-ts';

import type { PostPlaygroundOutput200 } from '@sdk-it/client';

import { Example } from './code-snippets';
import Background from './components/background';
import { Particles } from './components/particles';
import { Safari } from './components/safari';
import SpecBox from './components/spec-box';
import { TextGenerateEffect } from './components/text-generate-effect';
import { TreeView } from './components/tree';
import { Button, EyeCatchingButton, cn } from './shadcn';
import {
  Credenza,
  CredenzaBody,
  CredenzaContent,
  CredenzaTrigger,
} from './shadcn/lib/ui/credenza';
import { useRootData } from './use-root-data';
import { SpecBoxDemo } from './spec-box-demo';

export function Hero(props: { className?: string }) {
  return (
    <div
      className={cn(
        'scroll-target mx-auto grid w-full snap-start grid-cols-4 items-start gap-8 lg:grid-cols-7 lg:grid-rows-[auto_auto]',
        props.className,
      )}
    >
      <div className="col-span-full flex w-full flex-col items-center justify-center justify-self-center lg:col-span-4 lg:row-span-1 lg:items-start lg:justify-self-start">
        <h1 className="mb-4 font-sans md:font-mono">
          <TextGenerateEffect
            className="text-4xl font-semibold text-balance"
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
        <h2 className="text-muted-foreground leading-tight text-balance sm:text-lg lg:max-w-none lg:text-left">
          Cut costs, reduce maintenance, and boost productivity with type-safe
          client libraries, documentation, and agent tools — all generated
          automatically.
        </h2>
      </div>
      <div className="col-span-full inline-flex flex-col items-center justify-center gap-4 sm:flex-row lg:col-span-3 lg:row-start-2 lg:mb-0 lg:justify-start xl:col-span-4">
        <div className="flex items-center gap-8">
          <Button size={'lg'}>
            <a href="/">Get started</a>
          </Button>
          <EyeCatchingButton>
            <a href="https://cal.com/january-sh/30min"> Request a demo </a>
          </EyeCatchingButton>
        </div>
      </div>
      <div className="col-span-full flex w-full justify-center lg:col-span-full lg:col-start-5 lg:row-span-full lg:justify-end lg:justify-self-start xl:col-span-3 xl:col-start-5">
        <SpecBoxDemo />
      </div>
    </div>
  );
}
const tabs = [
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
  return (
    <Background className="relative mx-auto px-4 md:px-8 lg:px-8 xl:max-w-full xl:px-12 2xl:max-w-[1400px] 2xl:px-0 2xl:py-8">
      <Particles
        className="absolute inset-0"
        quantity={100}
        ease={30}
        color={'#000000'}
        refresh
      />
      <Hero />
      <div className="mt-32 w-full">
        <h2 className="mb-4 text-4xl font-semibold tracking-tight text-balance">
          Experiance Generated SDK Firsthand
        </h2>
        <h3 className="!text-muted-foreground tracking-tightlg:text-left mb-4 max-w-3xl text-xl leading-tight font-normal">
          Well crafted, type-safe SDKs tuned for the select language.
        </h3>
      </div>

      <StaticPlayground />
    </Background>
  );
}

export function StaticPlayground() {
  const { operations: data } = useRootData();
  const sdkInfo = useReadLocalStorage<PostPlaygroundOutput200 | null>(
    'ts-sdk-info',
  ) ?? {
    url: '',
    name: '@scope/client',
    title: '',
    clientName: 'Client',
  };

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

  const currentData = data[activeTab] as any;

  const currentSnippet = {
    typescript: currentData.typescript,
    dart: '', // Add dart support when available
    spec: currentData.spec,
  };
  return (
    <div className="mt-8 w-full rounded-lg border">
      <Safari className="h-auto w-full" />
      <div className="relative grid w-full grid-cols-1 gap-x-4 lg:grid-cols-7 lg:gap-12 xl:grid-cols-9">
        <div className="col-span-full px-2 py-2 lg:col-span-2">
          <TreeView
            onLeafSelect={(item) => {
              setActiveTab(item.id as keyof typeof data);
            }}
            selectedId={activeTab}
            data={Object.values(treeData)}
          />
        </div>
        <div className="col-span-full lg:col-start-3">
          <Example className="lg:border-l" snippet={currentSnippet} />
        </div>
      </div>
    </div>
  );
}
