import { useEffect, useRef } from 'react';

import type {
  OperationEntry,
  TunedOperationObject,
} from '@sdk-it/spec/operation.js';

interface UseScrollOperationsProps {
  operationsMap: Record<
    string,
    { entry: OperationEntry; operation: TunedOperationObject }
  >;
}

export function useScrollOperations({
  operationsMap,
}: UseScrollOperationsProps) {
  const contentRef = useRef<HTMLDivElement>(null);

  // Handle scroll event to update URL when scrolling
  useEffect(() => {
    if (Object.keys(operationsMap).length === 0) {
      return;
    }

    const handleScroll = () => {
      if (!contentRef.current) return;

      const operations = Object.entries(operationsMap);
      if (operations.length === 0) return;

      for (const [operationId, { entry }] of operations) {
        const element = document.getElementById(`operation-${operationId}`);
        if (!element) continue;

        const rect = element.getBoundingClientRect();
        // If the operation is in view (with some buffer), update the URL
        if (rect.top <= 150 && rect.bottom >= 0) {
          window.history.replaceState(
            null,
            '',
            `/${entry.groupName}/${operationId}`,
          );
          break;
        }
      }
    };

    const contentElement = contentRef.current;
    if (contentElement) {
      contentElement.addEventListener('scroll', handleScroll);
      return () => contentElement.removeEventListener('scroll', handleScroll);
    }
  }, [operationsMap]);

  return {
    contentRef,
  };
}
