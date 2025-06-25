import { Loader } from 'lucide-react';

import { ApiHeader } from './api-doc/api-header';
import { OperationsList } from './api-doc/operations-list.tsx';
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
import { useRootData } from './use-root-data';

export function HydrateFallback() {
  return <Loader className="animate-spin" />;
}

export default function Embed() {
  const { spec, sidebar } = useRootData();
  useScrollOperations();
  return (
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
        <div className="h-[calc(100vh-4rem)] overflow-y-auto">
          <OperationsList />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
