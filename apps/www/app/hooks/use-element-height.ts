import {
  type RefCallback,
  useCallback,
  useLayoutEffect,
  useState,
} from 'react';

// Define the return type of the hook
type UseElementHeightReturnType<T extends HTMLElement> = [
  RefCallback<T>,
  number,
];

function useElementHeight<
  T extends HTMLElement,
>(): UseElementHeightReturnType<T> {
  const [height, setHeight] = useState<number>(0);
  // State to store the element node, typed appropriately
  const [node, setNode] = useState<T | null>(null);

  // The ref callback, now strongly typed
  const ref: RefCallback<T> = useCallback((nodeInstance) => {
    if (nodeInstance !== null) {
      setNode(nodeInstance);
    }
  }, []);

  useLayoutEffect(() => {
    if (node) {
      const measure = () => {
        // Ensure measurements are taken after the browser has painted
        window.requestAnimationFrame(() => {
          setHeight(node.offsetHeight);
        });
      };

      // Initial measurement
      measure();

      // Observe for resize
      // ResizeObserverEntry is a built-in type
      const resizeObserver = new ResizeObserver(
        (entries: ResizeObserverEntry[]) => {
          // We only expect one entry here, but it's good practice to iterate or access directly
          // For simplicity, assuming the first entry is our element
          if (entries[0] && entries[0].target === node) {
            measure();
          }
        },
      );

      resizeObserver.observe(node);

      // Cleanup function
      return () => {
        if (node) {
          // Check if node still exists before trying to unobserve
          resizeObserver.unobserve(node);
        }
      };
    }
  }, [node]); // Rerun effect if the node changes

  return [ref, height];
}

export default useElementHeight;
