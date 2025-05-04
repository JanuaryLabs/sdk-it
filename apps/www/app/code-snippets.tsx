import { useState } from 'react';
import { BiLogoFlutter, BiLogoTypescript } from 'react-icons/bi';

import { Editor } from './editor/editor';
import {
  ScrollArea,
  ScrollBar,
  Tabs,
  TabsList,
  TabsTrigger,
  cn,
} from './shadcn';

interface EditorTabsProps {
  activeLanguage: string;
  setActiveLanguage: (language: string) => void;
  className?: string;
}

export function Example(props: { snippet: Record<string, string> }) {
  const [activeLanguage, setActiveLanguage] = useState<string>('typescript');

  return (
    <div className="h-full rounded border p-px">
      <EditorTabs
        className="bg-muted/50 border-b"
        activeLanguage={activeLanguage}
        setActiveLanguage={(lang) => setActiveLanguage(lang)}
      />
      <div className="h-[40vh]">
        <Editor
          key={activeLanguage}
          readonly
          language={activeLanguage}
          value={props.snippet[activeLanguage]}
        />
      </div>
    </div>
  );
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
            'bg-background mb-2 h-auto w-full justify-start -space-x-px rounded-none p-0 rtl:space-x-reverse',
            className,
          )}
        >
          <TabsTrigger
            value="typescript"
            className="data-[state=active]:bg-muted data-[state=active]:after:bg-primary relative gap-x-1 overflow-hidden rounded-none py-2 after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 data-[state=active]:shadow-none"
          >
            <BiLogoTypescript size={20} />
            TypeScript
          </TabsTrigger>
          <TabsTrigger
            value="dart"
            className="data-[state=active]:bg-muted data-[state=active]:after:bg-primary relative gap-x-1 overflow-hidden rounded-none py-2 after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 data-[state=active]:shadow-none"
          >
            <BiLogoFlutter size={20} />
            Dart
          </TabsTrigger>
        </TabsList>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
    </Tabs>
  );
}

export default {
  pagination: {
    typescript: `import { Openstatus } from '@openstatus/sdk';

const openstatus = new Openstatus({
  baseUrl: 'http://localhost:3000',
});

const result = await openstatus.request('GET /monitors', {
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
  },
  fileupload: {
    typescript: `import { Openstatus } from '@openstatus/sdk';

const openstatus = new Openstatus({
  baseUrl: 'http://localhost:3000',
});

const file = new File(['file content'], 'example.txt');
const result = await openstatus.request('POST /upload', {
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
  },
  streaming: {
    typescript: `import { Openstatus } from '@openstatus/sdk';

const openstatus = new Openstatus({
  baseUrl: 'http://localhost:3000',
});

const stream = await openstatus.request('GET /stream', {
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
  },
};
