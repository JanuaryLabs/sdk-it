import type { InfoObject } from 'openapi3-ts/oas31';
import type { RefObject } from 'react';

import type {
  OperationEntry,
  TunedOperationObject,
} from '@sdk-it/spec/operation.js';

import type { CategoryItem } from '../sidebar/nav';
import { ApiInfoSection } from './api-info';
import { OperationsList } from './operations-list';

interface ApiContentProps {
  contentRef: RefObject<HTMLDivElement | null>;
  info: InfoObject;
  sidebarData: CategoryItem[];
  operationsMap: Record<
    string,
    { entry: OperationEntry; operation: TunedOperationObject }
  >;
}

export function ApiContent({
  contentRef,
  info,
  sidebarData,
  operationsMap,
}: ApiContentProps) {
  return (
    <div
      ref={contentRef}
      className="h-[calc(100vh-4rem)] overflow-y-auto api-doc-scrollable"
    >
      <ApiInfoSection info={info} />
      <OperationsList sidebarData={sidebarData} operationsMap={operationsMap} />
    </div>
  );
}
