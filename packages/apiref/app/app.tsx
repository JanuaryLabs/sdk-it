import type { OpenAPIObject } from 'openapi3-ts/oas31';

import { loadRemote } from '@sdk-it/spec/loaders/remote-loader.js';
import {
  type TunedOperationObject,
  forEachOperation,
} from '@sdk-it/spec/operation.js';
import { toSidebar } from '@sdk-it/spec/sidebar.js';
import { TypeScriptGenerator } from '@sdk-it/typescript';

import { ApiContent } from './api-doc/api-content';
import { ApiHeader } from './api-doc/api-header';
import type { AugmentedOperation } from './api-doc/types';
import { useScrollOperations } from './hooks/use-scroll-operations';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
  SidebarRail,
} from './shadcn/sidebar';
import { NavMain } from './sidebar/nav';

type PromisedValue<T> = T extends Promise<infer U> ? U : never;

export async function loader({ params }: { params: { '*'?: string } }) {
  const spec = await loadRemote<OpenAPIObject>(
    'https://raw.githubusercontent.com/openai/openai-openapi/refs/heads/master/openapi.yaml',
    // 'https://api.openstatus.dev/v1/openapi',
  );

  const operationsMap: Record<
    string,
    { entry: AugmentedOperation; operation: TunedOperationObject }
  > = {};
  const generator = new TypeScriptGenerator(spec, {
    output: '',
  });

  forEachOperation({ spec }, (entry, operation) => {
    const operationId = operation.operationId;
    operationsMap[operationId] = {
      entry: {
        ...entry,
        snippets: [
          {
            language: 'TypeScript',
            code: generator.snippet(entry, operation),
          },
        ],
      },
      operation,
    };
  });

  return {
    spec,
    sidebar: toSidebar(spec, params['*'] || ''),
    operationsMap,
  };
}

export default function Page({
  loaderData: { sidebar: sidebarData, spec, operationsMap },
}: {
  loaderData: PromisedValue<ReturnType<typeof loader>>;
}) {
  const { contentRef } = useScrollOperations({
    sidebarData,
  });

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          {/* <TeamSwitcher teams={data.teams} /> */}
        </SidebarHeader>
        <SidebarContent className="gap-x-2 gap-y-0">
          <NavMain items={sidebarData} />
          {/* <NavProjects projects={data.projects} /> */}
        </SidebarContent>
        <SidebarFooter>{/* <NavUser user={data.user} /> */}</SidebarFooter>
        <SidebarRail />
      </Sidebar>
      <SidebarInset>
        <ApiHeader title={spec.info.title} />
        <ApiContent
          contentRef={contentRef}
          info={spec.info}
          sidebarData={sidebarData}
          operationsMap={operationsMap}
        />
      </SidebarInset>
    </SidebarProvider>
  );
}
