declare global {
  interface Window {
    worker: Worker;
    workerCallbacks: Map<string, (data: any) => void>;
  }
}

export function runWorker<T>({ content, id }: { content: string; id: string }) {
  // Initialize worker and callbacks map
  window.worker ??= new Worker(new URL('./md.worker.ts', import.meta.url), {
    name: 'markdown-worker',
    type: 'module',
  });
  window.workerCallbacks ??= new Map();

  const worker = window.worker;

  // Set up global handler if not already done
  if (!worker.onmessage) {
    worker.onmessage = (e) => {
      const callback = window.workerCallbacks.get(e.data.id);
      if (callback) {
        callback(e.data);
        window.workerCallbacks.delete(e.data.id);
      }
    };

    worker.onerror = (e) => {
      console.error('Worker error:', e);
    };
  }

  const defer = new Promise<T>((resolve, reject) => {
    window.workerCallbacks.set(id, (data) => {
      resolve(data as T);
    });
  });

  worker.postMessage({ id, content });

  return defer;
}

// Use this in your React components for cleanup
export function cleanupWorkerCallback(id: string) {
  if (window.workerCallbacks) {
    window.workerCallbacks.delete(id);
  }
}
