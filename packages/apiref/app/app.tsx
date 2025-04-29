import { Loader } from 'lucide-react';
import { useRouteLoaderData } from 'react-router';

import { ApiContent } from './api-doc/api-content';
import { ApiHeader } from './api-doc/api-header';
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
import { SpecProvider } from './spec-context';

type PromisedValue<T> = T extends Promise<infer U> ? U : never;

export function HydrateFallback() {
  return <Loader className="animate-spin" />;
}

export default function Page() {
  const {
    sidebar: sidebarData,
    spec,
    operationsMap,
  } = useRouteLoaderData('root');

  const { contentRef } = useScrollOperations({
    sidebarData,
  });

  return (
    <SpecProvider spec={spec}>
      <SidebarProvider>
        <Sidebar collapsible="icon" >
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
    </SpecProvider>
  );
}
