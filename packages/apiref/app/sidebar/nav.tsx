/* eslint-disable @nx/enforce-module-boundaries */
import { ChevronRight } from 'lucide-react';
import { NavLink, useParams } from 'react-router';
import { titlecase } from 'stringcase';

import { isEmpty } from '@sdk-it/core/utils.js';
import type { CategoryItem, NavItem, SidebarData } from '@sdk-it/spec';

import { Badge } from '../shadcn/badge';
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
import { useRootData } from '../use-root-data';

export function SidebarItem({ item }: { item: NavItem }) {
  const params = useParams();
  const route = params['*'] || '/';
  const [activeGroup, activeOperation] = route.split('/');
  const { operationsMap } = useRootData();
  return (
    <Collapsible
      asChild
      defaultOpen={activeGroup === item.id}
      className="group/collapsible"
    >
      <SidebarMenuItem>
        {!item.items?.length && (
          <NavLink to={item.url}>
            <SidebarMenuButton
              className="flex items-center justify-between p-2 text-sm font-normal"
              size={'default'}
              tooltip={item.title}
            >
              <span>{titlecase(item.title)}</span>
            </SidebarMenuButton>
          </NavLink>
        )}
        {item.items?.length && (
          <>
            <CollapsibleTrigger asChild>
              <SidebarMenuButton
                className="flex items-center justify-between p-2 text-sm font-normal"
                size={'default'}
                tooltip={item.title}
              >
                <span>{titlecase(item.title)}</span>
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
                      <a
                        href={import.meta.env.BASE_URL + subItem.url}
                        onClick={(e) => {
                          e.preventDefault();
                          window.history.replaceState(
                            null,
                            '',
                            `${import.meta.env.BASE_URL}${subItem.url}`,
                          );
                          const element = document.getElementById(subItem.id);
                          if (element) {
                            element.scrollIntoView({
                              behavior: 'instant',
                              block: 'start',
                              inline: 'nearest',
                            });
                          }
                        }}
                      >
                        {subItem.id in operationsMap && (
                          <Badge
                            variant={'ghost'}
                            className="min-w-8 px-0 hover:bg-transparent"
                          >
                            <code className="uppercase">
                              {operationsMap[subItem.id].entry.method ===
                              'delete'
                                ? 'DEL'
                                : operationsMap[subItem.id].entry.method}
                            </code>
                          </Badge>
                        )}
                        <span>{subItem.title}</span>
                      </a>
                    </SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                ))}
              </SidebarMenuSub>
            </CollapsibleContent>
          </>
        )}
      </SidebarMenuItem>
    </Collapsible>
  );
}

export function CategoryNav({ category }: { category: CategoryItem }) {
  return (
    <SidebarGroup className="py-0">
      <SidebarGroupLabel className="text-foreground text-sm font-semibold uppercase">
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
  return items.map((category) => (
    <CategoryNav key={category.category} category={category} />
  ));
  // return items.length === 1 ? (
  //   <SidebarMenu className="gap-0">
  //     {items[0].items.map((item) => (
  //       <SidebarItem key={item.title} item={item} />
  //     ))}
  //   </SidebarMenu>
  // ) : (
  //   items.map((category) => (
  //     <CategoryNav key={category.category} category={category} />
  //   ))
  // );
}
