import { camelcase } from 'stringcase';

import { notNullOrUndefined } from '@sdk-it/core/file-system.js';

import { forEachOperation } from './for-each-operation.js';
import type { IR } from './types.js';

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

export interface TagGroups {
  name: string;
  tags: string[];
}

export function toSidebar(spec: IR) {
  const sidebar: SidebarData = spec['x-docs'];
  for (const tagGroup of spec['x-tagGroups']) {
    sidebar.push({
      id: camelcase(tagGroup.name),
      category: tagGroup.name,
      items: tagGroup.tags.map((tag) => {
        const tagSpec = spec.tags?.find((t) => t.name === tag);
        return {
          id: crypto.randomUUID(),
          description: tagSpec?.description,
          title: tagSpec
            ? tagSpec['x-displayName'] || tagSpec.name || tag
            : tag,
          items: forEachOperation(spec, (entry, operation) => {
            if (operation.tags.includes(tag)) {
              const title = operation.summary || operation.operationId;
              return {
                id: operation.operationId,
                title,
                url: `${camelcase(tag)}/${camelcase(operation.operationId)}`,
              };
            }
            return null;
          }).filter(notNullOrUndefined),
        };
      }),
    });
  }
  return sidebar;
}
