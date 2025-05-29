import { Loader } from 'lucide-react';

import { ApiContent } from './api-doc/api-content';
import { ApiHeader } from './api-doc/api-header';
import { SearchCmdk } from './components/search';
import { useScrollOperations } from './hooks/use-scroll-operations';
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
} from './shadcn/sidebar';
import { NavMain } from './sidebar/nav';
import { SpecProvider } from './spec-context';
import { useRootData } from './use-root-data';

export function HydrateFallback() {
  return <Loader className="animate-spin" />;
}

export default function Embed() {
  const { spec, sidebar } = useRootData();
  useScrollOperations();
  return (
    <SpecProvider spec={spec}>
      <SidebarProvider>
        <Sidebar collapsible="offcanvas">
          <SidebarHeader>
            <SearchCmdk />
          </SidebarHeader>
          <SidebarContent className="gap-x-2 gap-y-0">
            <NavMain items={sidebar} />
          </SidebarContent>
          {/* <SidebarFooter></SidebarFooter> */}
        </Sidebar>
        <SidebarInset>
          <ApiHeader title={spec.info.title} />
          <ApiContent />
        </SidebarInset>
      </SidebarProvider>
    </SpecProvider>
  );
}
