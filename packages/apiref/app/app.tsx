import { Loader, Wand2 } from 'lucide-react';

import { OperationsList } from './api-doc/operations-list.tsx';
import { SearchCmdk } from './components/search';
import { useScrollOperations } from './hooks/use-scroll-operations';
import { Separator } from './shadcn/separator.tsx';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarInset,
  SidebarMenuSubButton,
  SidebarProvider,
} from './shadcn/sidebar';
import { NavMain } from './sidebar/nav';
import { useRootData } from './use-root-data';

export function HydrateFallback() {
  return <Loader className="animate-spin" />;
}

export default function Page() {
  const { sidebar } = useRootData();
  useScrollOperations();

  return (
    <SidebarProvider>
      <Sidebar
        collapsible="icon"
        className="left-5 group-data-[side=left]:border-none"
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
