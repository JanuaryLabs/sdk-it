import type { OpenAPIObject } from 'openapi3-ts/oas31';
import { camelcase } from 'stringcase';

export type ChildNavItem = {
  id: string;
  title: string;
  url: string;
  isActive?: boolean;
};

export type NavItem = {
  id: string;
  title: string;
  description?: string;
  url: string;
  isActive?: boolean;
  items?: ChildNavItem[];
};

export type CategoryItem = {
  category: string;
  description?: string;
  items: NavItem[];
  isActive?: boolean;
};

export type SidebarData = CategoryItem[];


export function toSidebar(spec: OpenAPIObject, route: string) {
  const openapi: OpenAPIObject & { 'x-oaiMeta': XOaiMeta } = spec as any;
  const sidebar: SidebarData = [];
  const [activeGroup] = route.split('/');
  for (const navGroup of openapi['x-oaiMeta'].navigationGroups) {
    const group = openapi['x-oaiMeta'].groups.filter(
      (group) => group.navigationGroup === navGroup.id,
    );
    sidebar.push({
      category: navGroup.title,
      isActive: false,
      items: group.map((item) => ({
        id: item.id,
        title: item.title,
        url: `/${item.id}`,
        isActive: activeGroup === item.id,
        description: item.description,
        items: (item.sections ?? [])
          .filter((it) => it.type === 'endpoint')
          .map((section) => ({
            id: section.key,
            title: section.key,
            url: `/${item.id}/${camelcase(section.key)}`,
            isActive: `/${item.id}/${camelcase(section.key)}` === `/${route}`,
          })),
      })),
    });
  }
  return sidebar;
}

export interface XOaiMeta {
  navigationGroups: NavigationGroup[];
  groups: Group[];
}

export interface Group {
  id: string;
  title: string;
  description: string;
  navigationGroup: string;
  sections?: Section[];
  beta?: boolean;
  legacy?: boolean;
}

export interface Section {
  type: 'endpoint' | 'object';
  key: string;
  path: string;
}

export interface NavigationGroup {
  id: string;
  title: string;
  beta?: boolean;
}
