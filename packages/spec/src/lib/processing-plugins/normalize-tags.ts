import type { TagObject } from 'openapi3-ts/oas31';

import { snakecase } from '@sdk-it/core/utils.js';

import { iterateOperations } from '../for-each-operation.js';
import type { DocumentPlugin } from '../processing.js';

/**
 * Gives each operation one group tag, and keeps every group defined: an
 * authored definition and tag group entry take the group's name (the authored
 * name stays as its display name), and a group nothing defines gets a bare
 * definition, so a host finds the definition of every operation's tag.
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
      for (const definition of spec.tags) {
        const name = renamed.get(definition.name) ?? definition.name;
        if (definitions.has(name)) {
          continue;
        }
        definitions.set(
          name,
          name === definition.name
            ? definition
            : {
                ...definition,
                name,
                'x-displayName': definition['x-displayName'] ?? definition.name,
              },
        );
      }
      for (const [authored, group] of renamed) {
        if (!definitions.has(group)) {
          definitions.set(group, { name: group, 'x-displayName': authored });
        }
      }
      for (const group of groups) {
        if (!definitions.has(group)) {
          definitions.set(group, { name: group });
        }
      }
      spec.tags = [...definitions.values()];
      spec['x-tagGroups'] = spec['x-tagGroups'].map((tagGroup) => ({
        ...tagGroup,
        tags: tagGroup.tags.map((tag) => renamed.get(tag) ?? tag),
      }));
    },
  };
}
