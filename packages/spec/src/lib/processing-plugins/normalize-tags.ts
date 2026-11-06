import type { TagObject } from 'openapi3-ts/oas32';

import { snakecase } from '@sdk-it/core/utils.js';

import { iterateOperations } from '../for-each-operation.js';
import type { DocumentPlugin } from '../processing.js';

/**
 * Gives each operation one group tag, and keeps every group defined: an
 * authored definition takes the group's name (the authored name stays as its
 * summary), a tag's parent follows the rename, and a group nothing defines
 * gets a definition, so a host finds the definition of every operation's tag.
 */
export function normalizeTags(): DocumentPlugin {
  return {
    name: 'normalize-tags',
    process({ spec, options }) {
      const renamed = new Map<string, string>();
      const groups = new Set<string>();
      for (const { entry, operation } of iterateOperations(spec)) {
        const tag = options.tag(operation, entry.path);
        const group = snakecase(tag);
        const [authored] = operation.tags ?? [];
        if (authored !== undefined) {
          renamed.set(authored, group);
        }
        groups.add(group);
        operation['x-fn-group'] = tag;
        operation.tags = [group];
      }

      const definitions = new Map<string, TagObject>();
      for (const authored of spec.tags) {
        const name = renamed.get(authored.name) ?? authored.name;
        if (definitions.has(name)) {
          continue;
        }
        const definition: TagObject =
          name === authored.name
            ? { ...authored }
            : {
                ...authored,
                name,
                summary: authored.summary ?? authored.name,
              };
        if (authored.parent !== undefined) {
          definition.parent = renamed.get(authored.parent) ?? authored.parent;
        }
        definitions.set(name, definition);
      }
      for (const [authored, group] of renamed) {
        if (!definitions.has(group)) {
          definitions.set(group, { name: group, summary: authored });
        }
      }
      for (const group of groups) {
        if (!definitions.has(group)) {
          definitions.set(group, { name: group });
        }
      }
      spec.tags = [...definitions.values()];
    },
  };
}
