import type { OpenAPIObject } from 'openapi3-ts/oas31';
import { useMemo } from 'react';
import { titlecase } from 'stringcase';

import {
  type OperationEntry,
  type TunedOperationObject,
  forEachOperation,
} from '@sdk-it/spec/operation.js';

import type { CategoryItem, ChildNavItem } from '../sidebar/nav';

export function useApiOperations(spec: OpenAPIObject) {
  return useMemo(() => {
    // Safety check for empty spec
    if (!spec || !spec.paths) {
      return { sidebarData: [], operationsMap: {} };
    }

    const categoryMap: Record<string, Record<string, ChildNavItem[]>> = {};
    const operationsMap: Record<
      string,
      { entry: OperationEntry; operation: TunedOperationObject }
    > = {};

    forEachOperation({ spec }, (entry, operation) => {
      const category = entry.tag;
      const group = entry.groupName;

      categoryMap[category] ??= {};
      categoryMap[category][group] ??= [];

      const operationId = operation.operationId;
      const title = entry.name || operation.summary || titlecase(operationId);
      const url = `/${group.toLowerCase()}/${operationId}`;

      categoryMap[category][group].push({
        title,
        url,
        isActive: true,
      });

      // Store operation details for rendering in the main content
      operationsMap[operationId] = {
        entry,
        operation,
      };
    });

    // Convert the map to the SidebarData structure
    const sidebarData: CategoryItem[] = Object.entries(categoryMap).map(
      ([categoryName, groupsMap]) => ({
        category: titlecase(categoryName),
        items: Object.entries(groupsMap).map(([groupName, operations]) => ({
          title: titlecase(groupName),
          url: `/${groupName}`,
          items: operations,
        })),
      }),
    );

    return {
      sidebarData,
      operationsMap,
    };
  }, [spec]);
}
