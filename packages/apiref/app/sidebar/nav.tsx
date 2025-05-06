import { ChevronRight } from 'lucide-react';
import { Link, useParams } from 'react-router';

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

export function SidebarItem({ item }: { item: NavItem }) {
  const params = useParams();
  const route = params['*'] || '/';
  const [activeGroup, activeOperation] = route.split('/');
  return (
    <Collapsible
      asChild
      defaultOpen={activeGroup === item.id}
      className="group/collapsible"
    >
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton
            className="flex items-center justify-between text-sm font-normal"
            size={'default'}
            tooltip={item.title}
          >
            {/* {item.icon && <item.icon />} */}
            <span>{item.title}</span>
            <ChevronRight className="transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub className="gap-0">
            {item.items?.map((subItem) => (
              <SidebarMenuSubItem key={subItem.title}>
                <SidebarMenuSubButton
                  asChild
                  isActive={activeOperation === subItem.id}
                  size="md"
                >
                  <Link to={import.meta.env.BASE_URL+subItem.url}>
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
    <SidebarGroup className="py-0">
      <SidebarGroupLabel className="text-foreground text-xs font-semibold uppercase">
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
