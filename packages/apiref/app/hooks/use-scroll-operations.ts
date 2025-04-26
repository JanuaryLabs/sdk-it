import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';

import type { SidebarData } from '@sdk-it/spec/sidebar.js';

interface UseScrollOperationsProps {
  sidebarData: SidebarData;
}

export function useScrollOperations({ sidebarData }: UseScrollOperationsProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const location = useLocation();

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
    const operationId = location.pathname.split('/').pop();
    if (!operationId) return;
    const element = document.getElementById(operationId);
    if (element) {
      const marginTop = 3 * 16; // 3 * 16px
      contentRef.current.scrollTo({
        top: element.offsetTop - marginTop,
        behavior: 'instant',
      });
    }
  }, [sidebarData, location]);

  return {
    contentRef,
  };
}
