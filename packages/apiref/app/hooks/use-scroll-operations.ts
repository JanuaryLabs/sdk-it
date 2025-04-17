import { useEffect, useRef } from 'react';

import type { SidebarData } from '../sidebar/nav';

interface UseScrollOperationsProps {
  sidebarData: SidebarData;
}

export function useScrollOperations({ sidebarData }: UseScrollOperationsProps) {
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!contentRef.current || sidebarData.length === 0) {
      return;
    }

    const handleScroll = () => {
      if (!contentRef.current) return;

      for (const category of sidebarData) {
        for (const item of category.items) {
          for (const subitem of item.items ?? []) {
            const element = document.getElementById(subitem.id);
            if (!element) continue;

            const rect = element.getBoundingClientRect();
            // If the operation is in view (with some buffer), update the URL
            if (rect.top <= 150 && rect.bottom >= 0) {
              window.history.replaceState(null, '', subitem.url);
              break;
            }
          }
        }
      }
    };

    const el = contentRef.current;
    el.addEventListener('scroll', handleScroll);
    return () => el.removeEventListener('scroll', handleScroll);
  }, [sidebarData]);

  useEffect(() => {
    if (!contentRef.current || sidebarData.length === 0) return;
    const operationId = window.location.pathname.split('/').pop();
    if (!operationId) return;
    const element = document.getElementById(operationId);
    if (element) {
      contentRef.current.scrollTo({
        top: element.offsetTop,
        behavior: 'instant',
      });
    }
  }, [sidebarData]);

  return {
    contentRef,
  };
}
