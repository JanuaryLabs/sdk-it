import type { OpenAPIObject } from 'openapi3-ts/oas31';
import { camelcase } from 'stringcase';

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
import { NavMain, type SidebarData } from './sidebar/nav';

export async function loader({ params }: { params: any }) {
  const spec = await loadRemote(
    'https://raw.githubusercontent.com/openai/openai-openapi/refs/heads/master/openapi.yaml',
    // 'https://api.openstatus.dev/v1/openapi',
  );
  const openapi: OpenAPIObject & { 'x-oaiMeta': XOaiMeta } = spec as any;
  const sidebar: SidebarData = [];
  for (const navGroup of openapi['x-oaiMeta'].navigationGroups) {
    const group = openapi['x-oaiMeta'].groups.filter(
      (group) => group.navigationGroup === navGroup.id,
    );
    const [activeGroup] = (params['*'] || '').split('/');
    sidebar.push({
      category: navGroup.title,
      isActive: false,
      items: group.map((item) => ({
        id: item.id,
        title: item.title,
        url: `/${item.id}`,
        isActive: activeGroup === item.id,
        description: item.description,
        items: (item.sections ?? [])
          .filter((it) => it.type === 'endpoint')
          .map((section) => ({
            id: section.key,
            title: section.key,
            url: `/${item.id}/${camelcase(section.key)}`,
            isActive:
              `/${item.id}/${camelcase(section.key)}` === `/${params['*']}`,
          })),
      })),
    });
  }
  return { spec, sidebar };
}

export default function Page({
  loaderData: { sidebar: sidebarData, spec },
}: {
  loaderData: { spec: OpenAPIObject; sidebar: SidebarData };
}) {
  const { operationsMap } = useApiOperations(spec);
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

export interface XOaiMeta {
  navigationGroups: NavigationGroup[];
  groups: Group[];
}

export interface Group {
  id: string;
  title: string;
  description: string;
  navigationGroup: string;
  sections?: Section[];
  beta?: boolean;
  legacy?: boolean;
}

export interface Section {
  type: 'endpoint' | 'object';
  key: string;
  path: string;
}

export interface NavigationGroup {
  id: string;
  title: string;
  beta?: boolean;
}
