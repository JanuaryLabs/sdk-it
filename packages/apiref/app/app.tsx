import type { OpenAPIObject } from 'openapi3-ts/oas31';

import { loadRemote } from '@sdk-it/spec/loaders/remote-loader.js';

import { ApiContent } from './api-doc/api-content';
import { ApiHeader } from './api-doc/api-header';
import { useApiOperations } from './hooks/use-api-operations';
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

export async function loader() {
  const spec = await loadRemote(
    // 'https://raw.githubusercontent.com/openai/openai-openapi/refs/heads/master/openapi.yaml',
    'https://api.openstatus.dev/v1/openapi',
  );
  return spec;
}

export default function Page({
  loaderData: spec,
}: {
  loaderData: OpenAPIObject;
}) {
  const { sidebarData, operationsMap } = useApiOperations(spec);
  const { contentRef } = useScrollOperations({
    operationsMap,
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
