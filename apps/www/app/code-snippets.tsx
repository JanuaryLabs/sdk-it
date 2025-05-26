import { type ReactNode, useState } from 'react';
import { BiLogoFlutter, BiLogoTypescript } from 'react-icons/bi';
import { SiOpenapiinitiative } from 'react-icons/si';
import { camelcase } from 'stringcase';

import { StillMarkdown } from './components/md';
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
      <div className="lg:h-[calc(100%-37px)] lg:min-h-[51vh] lg:max-h-full max-h-96 overflow-auto">
        <StillMarkdown
          className={cn('h-full min-w-full', {
            // prose: activeLanguage === 'spec',
            prose: true,
          })}
          id={activeLanguage}
          content={props.snippet[activeLanguage]}
        />
      </div>
      {/* <div className="h-[40vh]">
        <Editor
          key={activeLanguage}
          readonly
          language={activeLanguage === 'spec' ? 'json' : activeLanguage}
          value={(props.snippet[activeLanguage] || '').substring(14,)}
        />
      </div> */}
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

export default {
  pagination: (sdkInfo: SdkInfo) => ({
    typescript: `import { ${sdkInfo.clientName} } from '${sdkInfo.name}';

const ${camelcase(sdkInfo.clientName)} = ${sdkInfo.clientName}({
  baseUrl: 'http://localhost:3000',
});

const result = await ${camelcase(sdkInfo.clientName)}.request('GET /monitors', {
  page: 1,
  limit: 10
});

console.log(result.data);`,
    dart: `import 'package:openstatus_sdk/openstatus_sdk.dart';

void main() async {
  final client = Openstatus(
    baseUrl: 'http://localhost:3000',
  );

  // Pagination example with Dart
  final result = await client.monitors.list(
    ListMonitors(
      page: 1,
      limit: 10,
    )
  );

  print(result.data);
}`,
  }),
  fileupload: (sdkInfo: SdkInfo) => ({
    typescript: `import { ${sdkInfo.clientName} } from '${sdkInfo.name}';

const ${camelcase(sdkInfo.clientName)} = new ${sdkInfo.clientName}({
  baseUrl: 'http://localhost:3000',
});

const file = new File(['file content'], 'example.txt');
const result = await ${camelcase(sdkInfo.clientName)}.request('POST /upload', {
  content: file
});

console.log(result.data);`,
    dart: `import 'package:openstatus_sdk/openstatus_sdk.dart';
import 'dart:io';

void main() async {
  final client = Openstatus(
    baseUrl: 'http://localhost:3000',
  );

  final file = File('example.txt');
  final result = await client.artifact.upload(
    UploadArtifact(
      content: file,
    )
  );

  print(result.data);
}`,
  }),
  streaming: (sdkInfo: SdkInfo) => ({
    typescript: `import { Openstatus } from '@openstatus/sdk';

const ${camelcase(sdkInfo.clientName)} = new ${sdkInfo.clientName}({
  baseUrl: 'http://localhost:3000',
});

const stream = await ${camelcase(sdkInfo.clientName)}.request('GET /stream', {
  responseType: 'stream'
});

for await (const chunk of stream.data) {
  console.log(chunk);
}`,
    dart: `import 'package:openstatus_sdk/openstatus_sdk.dart';

void main() async {
  final client = Openstatus(
    baseUrl: 'http://localhost:3000',
  );

  final stream = await client.delivery.track(
    TrackDelivery(
      id: 'your-delivery-id',
    )
  );

  await for (final chunk in stream.data) {
    print(chunk);
  }
}`,
  }),
};
