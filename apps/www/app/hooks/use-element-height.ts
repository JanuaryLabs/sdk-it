import { useCallback, useEffect, useRef, useState } from 'react';

export function useElementHeight<T extends HTMLElement = HTMLDivElement>() {
  const [height, setHeight] = useState<number>(0);
  const elementRef = useRef<T>(null);

  const updateHeight = useCallback(() => {
    if (elementRef.current) {
      setHeight(elementRef.current.clientHeight);
    }
  }, []);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;

    // Initial measurement
    updateHeight();

    // Create ResizeObserver to track size changes
    const resizeObserver = new ResizeObserver((e) => {
      updateHeight();
    });

    resizeObserver.observe(element);

    // Cleanup
    return () => {
      resizeObserver.disconnect();
    };
  }, [updateHeight]);

  return {
    ref: elementRef,
    height,
    setHeight: (newHeight: number) => setHeight(newHeight),
  };
}
