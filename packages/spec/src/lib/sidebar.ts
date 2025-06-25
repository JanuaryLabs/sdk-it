import type { OpenAPIObject } from 'openapi3-ts/oas31';
import { camelcase } from 'stringcase';

import { forEachOperation } from './for-each-operation.js';
import type { OurOpenAPIObject, TunedOperationObject } from './types.ts';

export type ChildNavItem = {
  id: string;
  title: string;
  url: string;
};

export type NavItem = {
  id: string;
  title: string;
  description?: string;
  url?: string;
  items?: ChildNavItem[];
  content?: string; // Markdown content
};

export type CategoryItem = {
  id: string;
  category: string;
  description?: string;
  items: NavItem[];
};

export type SidebarData = CategoryItem[];

function createOAIMeta(spec: OurOpenAPIObject): XOaiMeta {
  spec.paths ??= {};
  const navigationGroups: Record<string, NavigationGroup> = {
    api: { id: 'api', title: 'API' },
  };
  const groups: Record<string, Group> = {};

  forEachOperation(spec, (entry, operation) => {
    const tag = entry.tag;
    groups[tag] ??= {
      id: tag,
      title: tag,
      description: spec.tags?.find((t) => t.name === tag)?.description,
      navigationGroup: 'api',
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

function getOperationById(spec: OurOpenAPIObject, operationId: string) {
  let operation: TunedOperationObject | undefined;
  forEachOperation(spec, (entry, op) => {
    if (op.operationId === operationId) {
      operation = op;
    }
  });
  return operation;
}

export function toSidebar(spec: OurOpenAPIObject) {
  const openapi: OpenAPIObject & { 'x-oaiMeta': XOaiMeta } = spec as any;
  const sidebar: SidebarData = spec['x-docs'];
  const oaiMeta = openapi['x-oaiMeta'] ?? createOAIMeta(spec);
  for (const navGroup of oaiMeta.navigationGroups) {
    const group = oaiMeta.groups.filter(
      (group) => group.navigationGroup === navGroup.id,
    );
    if (group.length === 0) continue;
    const groupItems: NavItem[] = [];
    for (const item of group) {
      const subitems: ChildNavItem[] = (item.sections ?? [])
        .filter((it) => it.type === 'endpoint')
        .map((section) => {
          const operation = getOperationById(spec, section.key);
          const title =
            operation?.['x-oaiMeta']?.name || operation?.summary || section.key;
          return {
            id: section.key,
            title,
            url: `${item.id}/${camelcase(section.key)}`,
          };
        });
      if (subitems.length === 0) continue;
      groupItems.push({
        id: item.id,
        title: item.title,
        // url: `/${item.id}`,
        description: item.description,
        items: subitems,
      });
    }
    if (groupItems.length === 0) continue;
    sidebar.push({
      id: navGroup.id,
      category: navGroup.title,
      items: groupItems,
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
  type: 'endpoint' | 'object' | 'overview';
  key: string;
  path: string;
}

export interface NavigationGroup {
  id: string;
  title: string;
  beta?: boolean;
}
