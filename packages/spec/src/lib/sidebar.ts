import type { OpenAPIObject, OperationObject } from 'openapi3-ts/oas31';
import { camelcase } from 'stringcase';

import { type TunedOperationObject, forEachOperation } from './operation';

export type ChildNavItem = {
  id: string;
  title: string;
  url: string;
};

export type NavItem = {
  id: string;
  title: string;
  description?: string;
  url: string;
  items?: ChildNavItem[];
};

export type CategoryItem = {
  category: string;
  description?: string;
  items: NavItem[];
};

export type SidebarData = CategoryItem[];

function createOAIMeta(spec: OpenAPIObject): XOaiMeta {
  spec.paths ??= {};
  const navigationGroups: Record<string, NavigationGroup> = {
    default: { id: 'default', title: 'General' },
  };
  const groups: Record<string, Group> = {};

  forEachOperation({ spec }, (entry, operation) => {
    const tag = entry.tag;
    groups[tag] ??= {
      id: tag,
      title: tag,
      description: spec.tags?.find((t) => t.name === tag)?.description,
      navigationGroup: 'default',
      sections: [],
    };
    groups[tag].sections.push({
      type: 'endpoint',
      key: operation.operationId,
      path: entry.path,
    });
  });

  return {
    groups: Object.values(groups),
    navigationGroups: Object.values(navigationGroups),
  };
}

function getOperationById(spec: OpenAPIObject, operationId: string) {
  let operation: TunedOperationObject | undefined;
  forEachOperation({ spec }, (entry, op) => {
    if (op.operationId === operationId) {
      operation = op;
    }
  });
  return operation;
}

export function toSidebar(spec: OpenAPIObject) {
  const openapi: OpenAPIObject & { 'x-oaiMeta': XOaiMeta } = spec as any;
  const sidebar: SidebarData = [];
  const oaiMeta = openapi['x-oaiMeta'] ?? createOAIMeta(spec);
  for (const navGroup of oaiMeta.navigationGroups) {
    const group = oaiMeta.groups.filter(
      (group) => group.navigationGroup === navGroup.id,
    );
    sidebar.push({
      category: navGroup.title,
      items: group.map((item) => ({
        id: item.id,
        title: item.title,
        url: `/${item.id}`,
        description: item.description,
        items: (item.sections ?? [])
          .filter((it) => it.type === 'endpoint')
          .map((section) => ({
            id: section.key,
            title: getOperationById(spec, section.key)?.summary || section.key,
            url: `${item.id}/${camelcase(section.key)}`,
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
  description?: string;
  navigationGroup: string;
  sections: Section[];
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
