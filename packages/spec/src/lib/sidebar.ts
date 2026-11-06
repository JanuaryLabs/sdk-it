import type { TagObject } from 'openapi3-ts/oas32';
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

/**
 * The documentation pages, then one section per tag hierarchy (OpenAPI 3.2
 * `parent`): each group with operations sits under its top-most ancestor's
 * section, and a group with no parent sits in the API section.
 */
export function toSidebar(spec: IR) {
  const sidebar: SidebarData = [...spec['x-docs']];
  const tags = new Map(spec.tags.map((tag) => [tag.name, tag]));
  const sections = new Map<TagObject | undefined, CategoryItem>();
  for (const tag of spec.tags) {
    const operations = forEachOperation(spec, (entry, operation) =>
      operation.tags.includes(tag.name)
        ? {
            id: operation.operationId,
            title: operation.summary || operation.operationId,
            url: `${camelcase(tag.name)}/${camelcase(operation.operationId)}`,
          }
        : null,
    ).filter(notNullOrUndefined);
    if (operations.length === 0) {
      continue;
    }
    const root = topAncestor(tag, tags);
    let section = sections.get(root);
    if (!section) {
      section = root
        ? {
            id: camelcase(root.name),
            category: root.summary ?? root.name,
            description: root.description,
            items: [],
          }
        : { id: camelcase('API'), category: 'API', items: [] };
      sections.set(root, section);
      sidebar.push(section);
    }
    section.items.push({
      id: crypto.randomUUID(),
      title: tag.summary ?? tag.name,
      description: tag.description,
      items: operations,
    });
  }
  return sidebar;
}

/** The tag that `tag`'s parent chain ends at; none for a tag without a parent. A chain stops at a name no tag has or one it already passed. */
function topAncestor(tag: TagObject, tags: Map<string, TagObject>) {
  let ancestor: TagObject | undefined;
  const passed = new Set([tag.name]);
  let parent = tag.parent;
  while (parent !== undefined && !passed.has(parent)) {
    const next = tags.get(parent);
    if (!next) {
      break;
    }
    passed.add(parent);
    ancestor = next;
    parent = next.parent;
  }
  return ancestor;
}
