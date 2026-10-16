import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
} from '@zukhruf/shadcn';
import { Loader } from 'lucide-react';
import type { CSSProperties } from 'react';

import { OperationsList } from './api-doc/operations-list.tsx';
import { SearchCmdk } from './components/search';
import { useScrollOperations } from './hooks/use-scroll-operations';
import { NavMain } from './sidebar/nav';
import { useRootData } from './use-root-data';

export function HydrateFallback() {
  return <Loader className="animate-spin" />;
}

export default function Embed() {
  const { sidebar } = useRootData();
  useScrollOperations();
  return (
    <SidebarProvider style={{ '--sidebar-width': '18rem' } as CSSProperties}>
      <Sidebar
        collapsible="offcanvas"
        className="*:data-[slot=sidebar-inner]:px-2"
      >
        <SidebarHeader>
          <SearchCmdk />
        </SidebarHeader>
        <SidebarContent className="gap-x-2 gap-y-0">
          <NavMain items={sidebar} />
        </SidebarContent>
        {/* <SidebarFooter></SidebarFooter> */}
      </Sidebar>
      <SidebarInset>
        <div className="h-[calc(100vh-4rem)] overflow-y-auto">
          <OperationsList />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
