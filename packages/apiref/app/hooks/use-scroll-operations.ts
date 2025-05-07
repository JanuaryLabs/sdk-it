import { useLayoutEffect, useRef } from 'react';
import { useParams } from 'react-router';

export function useScrollOperations() {
  const params = useParams();
  const ref = useRef<HTMLElement | null>(null);

  useLayoutEffect(
    () => {
      if (!params.operationId) {
        document.body.classList.remove('invisible');
        return;
      }
      const operation = params.operationId;
      const element = document.getElementById(operation);
      if (!element) {
        document.body.classList.remove('invisible');
        return;
      }
      element.scrollIntoView({
        behavior: 'instant',
        block: 'start',
        inline: 'nearest',
      });
      document.body.classList.remove('invisible');
    },
    [
      // only scroll on page open
    ],
  );

  return {
    contentRef: ref,
  };
}
