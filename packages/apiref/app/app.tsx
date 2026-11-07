import {
  Separator,
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarInset,
  SidebarMenuSubButton,
  SidebarProvider,
} from '@zukhruf/shadcn';
import { Loader, Wand2 } from 'lucide-react';

import { OperationsList } from './api-doc/operations-list.tsx';
import { SearchCmdk } from './components/search.tsx';
import { useScrollOperations } from './hooks/use-scroll-operations.ts';
import { NavMain } from './sidebar/nav.tsx';
import { useRootData } from './use-root-data.tsx';

export function HydrateFallback() {
  return <Loader className="animate-spin" />;
}

export default function Page() {
  const { sidebar } = useRootData();
  useScrollOperations();

  return (
    <SidebarProvider style={{ '--sidebar-width': '18rem' }}>
      <Sidebar
        collapsible="icon"
        className="group-data-[side=left]:border-none data-[side=left]:left-5 *:data-[slot=sidebar-inner]:px-2"
      >
        {/* <SidebarHeader>
          <SearchCmdk />
        </SidebarHeader> */}
        <SidebarContent className="gap-x-2 gap-y-0">
          <NavMain items={sidebar} />
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenuSubButton className="h-10 cursor-pointer">
            <Wand2 className="size-4" />
            Ask AI
          </SidebarMenuSubButton>
          <Separator />
          <SearchCmdk />
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <div className="h-[calc(100vh-4rem)] overflow-y-auto">
          <OperationsList />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
