import { ChevronRight, type LucideIcon } from 'lucide-react';

import type { SidebarData } from '@sdk-it/spec/sidebar.js';

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../shadcn/collapsible';
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from '../shadcn/sidebar';

export function NavMain({ items }: { items: SidebarData }) {
  return (
    <>
      {items.map((category) => (
        <SidebarGroup key={category.category} className="py-0 ">
          <SidebarGroupLabel className="text-sm text-foreground font-bold uppercase">
            {category.category}
          </SidebarGroupLabel>
          <SidebarMenu className="gap-0">
            {category.items.map((item) => (
              <Collapsible
                key={item.title}
                asChild
                defaultOpen={item.isActive}
                className="group/collapsible"
              >
                <SidebarMenuItem>
                  <CollapsibleTrigger asChild>
                    <SidebarMenuButton
                      className="text-sm font-normal"
                      size={'sm'}
                      tooltip={item.title}
                    >
                      <ChevronRight className=" transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                      {/* {item.icon && <item.icon />} */}
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <SidebarMenuSub className="gap-0">
                      {item.items?.map((subItem) => (
                        <SidebarMenuSubItem key={subItem.title}>
                          <SidebarMenuSubButton
                            className="text-sm text-gray-600"
                            asChild
                            isActive={subItem.isActive}
                            size="sm"
                          >
                            <a href={subItem.url}>
                              <span>{subItem.title}</span>
                            </a>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      ))}
                    </SidebarMenuSub>
                  </CollapsibleContent>
                </SidebarMenuItem>
              </Collapsible>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      ))}
    </>
  );
}
