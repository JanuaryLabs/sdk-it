import { useState } from 'react';

import type { PostPlayground } from '@sdk-it/client';

import {
  Credenza,
  CredenzaBody,
  CredenzaContent,
  CredenzaTrigger,
} from '../components/credenza.tsx';
import SpecBox from './spec-box.tsx';

export function SpecBoxDemo() {
  const [selectedTab, setSelectedTab] = useState('generate-sdk');
  const [open, setOpen] = useState(false);
  const [sdkInfo, setSdkInfo] = useState<PostPlayground | undefined>();
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
