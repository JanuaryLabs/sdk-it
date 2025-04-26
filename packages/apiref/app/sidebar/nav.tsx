import { ChevronRight, type LucideIcon } from 'lucide-react';

import { isEmpty } from '@sdk-it/core';
import type {
  CategoryItem,
  NavItem,
  SidebarData,
} from '@sdk-it/spec/sidebar.js';

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
import { Link } from 'react-router';

export function SidebarItem({ item }: { item: NavItem }) {
  return (
    <Collapsible
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
                  <Link

                    to={subItem.url}>
                    <span>{subItem.title}</span>
                  </Link>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
}

export function CategoryNav({ category }: { category: CategoryItem }) {
  return (
    <SidebarGroup className="py-0 ">
      <SidebarGroupLabel className="text-xs text-foreground font-semibold uppercase">
        {category.category}
      </SidebarGroupLabel>
      <SidebarMenu className="gap-0">
        {category.items.map((item) => (
          <SidebarItem key={item.title} item={item} />
        ))}
      </SidebarMenu>
    </SidebarGroup>
  );
}

export function NavMain({ items }: { items: SidebarData }) {
  if (isEmpty(items)) return null;
  return items.length === 1 ? (
    <SidebarMenu className="gap-0">
      {items[0].items.map((item) => (
        <SidebarItem key={item.title} item={item} />
      ))}
    </SidebarMenu>
  ) : (
    items.map((category) => (
      <CategoryNav key={category.category} category={category} />
    ))
  );
}
