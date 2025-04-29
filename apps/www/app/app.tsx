import { motion } from 'motion/react';
import { Suspense, useState } from 'react';

import Background from './components/background';
import { TextGenerateEffect } from './components/text-generate-effect';
import { Title } from './components/title';
import { VercelTabs } from './components/vercel-tabs';
import { Editor } from './editor/editor';
import {
  ScrollArea,
  ScrollBar,
  Tabs,
  TabsList,
  TabsTrigger,
  cn,
} from './shadcn';

export default function App() {
  return (
    <Suspense>
      <Background className="w-full lg:py-24">
        <div className="mx-auto flex w-full max-w-7xl flex-col items-center justify-between gap-16 px-6 md:flex-row lg:gap-40 xl:px-0">
          <div className="flex w-full flex-1 flex-col justify-center md:w-2/5">
            <h1 className="mb-8 font-sans md:font-mono">
              <TextGenerateEffect
                className="text-3xl font-bold lg:text-5xl"
                filter={false}
                duration={1.5}
                wordClassMap={{
                  developer: 'text-green-700',
                  'experience.': 'underline tracking-widest',
                  'OpenAPI/Swagger': 'text-blue-600',
                }}
                words={
                  'Turn your OpenAPI/Swagger into a premium developer experience.'
                }
              />
            </h1>
            <motion.p
              className="text-sm sm:text-lg md:text-xl lg:text-2xl font-overusedGrotesk pt-4 sm:pt-8 md:pt-10 lg:pt-12"
              animate={{ opacity: 1, y: 0 }}
              initial={{ opacity: 0, y: 20 }}
              transition={{ duration: 0.2, ease: 'easeOut', delay: 0.5 }}
            >
              Cut costs, reduce maintenance, and boost productivity with
              type-safe client libraries, documentation, and agent tools — all
              generated automatically.
            </motion.p>

            {/* <div className="items-start md:flex">
            <Try />
          </div> */}
          </div>
          <div className="md:w-3/5">
            {/*
            <div className="mt-8 flex flex-col gap-4 md:flex-row md:items-center md:gap-8">
              <EyeCatchingButton className="lg:h-12 lg:text-lg" size={'lg'}>
                <a href="https://cal.com/january-sh/30min" target="_blank">
                  Request a demo
                </a>
              </EyeCatchingButton>
              <Button
                size={'lg'}
                className="h-11 rounded-full px-12 shadow-none lg:h-12 lg:text-lg"
              >
                <a href="#integrations-section">Integrations</a>
              </Button>
            </div> */}
            <Right />
          </div>
        </div>
      </Background>
    </Suspense>
  );
}

const tabs = [
  { id: 'pagination', label: 'Pagination' },
  { id: 'filepload', label: 'File Upload' },
  { id: 'streaming', label: 'Streaming' },
];

type TabId = 'pagination' | 'filepload' | 'streaming';
type Language = 'typescript' | 'dart';

// Sample code snippets for each tab and language
const codeSnippets: Record<TabId, Record<Language, string>> = {
  pagination: {
    typescript: `import { Openstatus } from '@openstatus/sdk';

const openstatus = new Openstatus({
  baseUrl: 'http://localhost:3000',
});

// Pagination example with TypeScript
const result = await openstatus.request('GET /monitors', {
  pagination: { page: 1, limit: 10 }
});

console.log(result.data);`,
    dart: `import 'package:openstatus_sdk/openstatus_sdk.dart';

void main() async {
  final openstatus = Openstatus(
    baseUrl: 'http://localhost:3000',
  );

  // Pagination example with Dart
  final result = await openstatus.request('GET /monitors',
    pagination: Pagination(page: 1, limit: 10)
  );

  print(result.data);
}`,
  },
  filepload: {
    typescript: `import { Openstatus } from '@openstatus/sdk';

const openstatus = new Openstatus({
  baseUrl: 'http://localhost:3000',
});

// File upload example with TypeScript
const file = new File(['file content'], 'example.txt');
const result = await openstatus.request('POST /upload', {
  body: { file }
});

console.log(result.data);`,
    dart: `import 'package:openstatus_sdk/openstatus_sdk.dart';
import 'dart:io';

void main() async {
  final openstatus = Openstatus(
    baseUrl: 'http://localhost:3000',
  );

  // File upload example with Dart
  final file = File('example.txt');
  final result = await openstatus.request('POST /upload',
    body: {'file': await file.readAsBytes()}
  );

  print(result.data);
}`,
  },
  streaming: {
    typescript: `import { Openstatus } from '@openstatus/sdk';

const openstatus = new Openstatus({
  baseUrl: 'http://localhost:3000',
});

// Streaming example with TypeScript
const stream = await openstatus.request('GET /stream', {
  responseType: 'stream'
});

for await (const chunk of stream.data) {
  console.log(chunk);
}`,
    dart: `import 'package:openstatus_sdk/openstatus_sdk.dart';

void main() async {
  final openstatus = Openstatus(
    baseUrl: 'http://localhost:3000',
  );

  // Streaming example with Dart
  final stream = await openstatus.request('GET /stream',
    responseType: ResponseType.stream
  );

  await for (final chunk in stream.data) {
    print(chunk);
  }
}`,
  },
};

export function Right() {
  const [activeTab, setActiveTab] = useState<TabId>(tabs[0].id as TabId);
  const [activeLanguage, setActiveLanguage] = useState<Language>('typescript');

  return (
    <div className="flex flex-col space-y-4 w-full">
      <VercelTabs
        tabs={tabs}
        onTabChange={(tabId: string) => setActiveTab(tabId as TabId)}
      />
      <div className="border rounded p-px">
        <EditorTabs
          className="border-b bg-muted/50"
          activeLanguage={activeLanguage}
          setActiveLanguage={(lang: string) =>
            setActiveLanguage(lang as Language)
          }
        />
        <div className="h-[30vh]">
          <Editor
            readonly={true}
            language={activeLanguage}
            value={codeSnippets[activeTab][activeLanguage]}
          />
        </div>
      </div>
    </div>
  );
}

interface EditorTabsProps {
  activeLanguage: Language;
  setActiveLanguage: (language: string) => void;
  className?: string;
}

function EditorTabs({
  activeLanguage,
  setActiveLanguage,
  className,
}: EditorTabsProps) {
  return (
    <Tabs value={activeLanguage} onValueChange={setActiveLanguage}>
      <ScrollArea>
        <TabsList
          className={cn(
            'rounded-none w-full mb-2 p-0 justify-start h-auto -space-x-px bg-background rtl:space-x-reverse',
            className,
          )}
        >
          <TabsTrigger
            value="typescript"
            className="relative overflow-hidden rounded-none  py-2 after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 data-[state=active]:bg-muted data-[state=active]:after:bg-primary data-[state=active]:shadow-none"
          >
            {/* <Code2
              className="-ms-0.5 me-1.5 opacity-60"
              size={16}
              strokeWidth={2}
              aria-hidden="true"
            /> */}
            TypeScript
          </TabsTrigger>
          <TabsTrigger
            value="dart"
            className="relative overflow-hidden rounded-none  py-2 after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 data-[state=active]:bg-muted data-[state=active]:after:bg-primary data-[state=active]:shadow-none"
          >
            {/* <Code2
              className="-ms-0.5 me-1.5 opacity-60"
              size={16}
              strokeWidth={2}
              aria-hidden="true"
            /> */}
            Dart
          </TabsTrigger>
        </TabsList>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
    </Tabs>
  );
}
