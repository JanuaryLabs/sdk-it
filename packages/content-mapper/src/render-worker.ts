import { type MessagePort, workerData } from 'node:worker_threads';

import { renderDocument } from './render-document.js';

const { signal, port }: { signal: Int32Array; port: MessagePort } = workerData;

async function answer({
  fileName,
  content,
}: {
  fileName: string;
  content: string;
}) {
  try {
    port.postMessage({ rendered: await renderDocument(fileName, content) });
  } catch (error) {
    port.postMessage({
      error: Error.isError(error) ? error.message : String(error),
    });
  }
  Atomics.store(signal, 0, 1);
  Atomics.notify(signal, 0);
}

port.on('message', (request) => void answer(request));
