import { useLayoutEffect, useRef, useState } from 'react';
import { useParams } from 'react-router';

export function useScrollOperations() {
  const params = useParams();
  const [operationId] = useState(params.operationId);
  const ref = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    if (!operationId) {
      document.body.classList.remove('invisible');
      return;
    }
    const element = document.getElementById(operationId);
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
  }, [operationId]);

  return {
    contentRef: ref,
  };
}
