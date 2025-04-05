'use client';

import { ChevronRight, type LucideIcon } from 'lucide-react';

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../shadcn/collapsible';
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from '../shadcn/sidebar';

export type ChildNavItem = {
  title: string;
  url: string;
  isActive?: boolean;
};

export type NavItem = {
  title: string;
  url: string;
  icon?: LucideIcon;
  isActive?: boolean;
  items?: ChildNavItem[];
};

export type CategoryItem = {
  category: string;
  items: NavItem[];
  isActive?: boolean;
};

export type SidebarData = CategoryItem[];

export function NavMain({ items }: { items: SidebarData }) {
  return (
    <>
      {items.map((category) => (
        <SidebarGroup key={category.category} className="py-0">
          {/* <SidebarGroupLabel className="text-xs text-muted-foreground uppercase">
            {category.category}
          </SidebarGroupLabel> */}
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
                      className="text-xs font-normal"
                      size={'sm'}
                      tooltip={item.title}
                    >
                      <ChevronRight className=" transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                      {item.icon && <item.icon />}
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <SidebarMenuSub className="gap-0">
                      {item.items?.map((subItem) => (
                        <SidebarMenuSubItem key={subItem.title}>
                          <SidebarMenuSubButton
                            className="text-xs font-normal"
                            asChild
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
