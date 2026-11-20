import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  MessageChannel,
  Worker,
  receiveMessageOnPort,
} from 'node:worker_threads';

import type { RenderedDocument } from './render-document.js';

// Node's load hook is synchronous and renderDocument is async, so a worker
// renders while this thread waits (zukhruf #4966 will own this bridge, sdk-it #4967).
const signal = new Int32Array(new SharedArrayBuffer(4));
const { port1, port2 } = new MessageChannel();
const worker = new Worker(new URL('./render-worker.js', import.meta.url), {
  // Without this the worker inherits --import and registers itself again.
  execArgv: [],
  workerData: { signal, port: port2 },
  transferList: [port2],
});
worker.unref();
port1.unref();

const isDocument = (path: string) =>
  path.endsWith('.openapi.yaml') || path.endsWith('.openapi');

function render(fileName: string) {
  const content = readFileSync(fileName, 'utf8');
  Atomics.store(signal, 0, 0);
  port1.postMessage({ fileName, content });
  Atomics.wait(signal, 0, 0);
  const reply: { rendered: RenderedDocument } | { error: string } =
    receiveMessageOnPort(port1)?.message;
  if ('error' in reply) {
    throw new Error(`${fileName}: ${reply.error}`);
  }
  const { rendered } = reply;
  const [problem] = rendered.diagnostics;
  if (problem) {
    const before = content.slice(0, problem.range.start);
    const line = before.split('\n').length;
    const column = problem.range.start - (before.lastIndexOf('\n') + 1) + 1;
    throw new SyntaxError(`${fileName}:${line}:${column}: ${problem.message}`);
  }
  if (rendered.kind === 'failed') {
    throw new Error(`${fileName}: the document did not render`);
  }
  return rendered.text;
}

registerHooks({
  load(url, context, nextLoad) {
    if (!url.startsWith('file:') || !isDocument(fileURLToPath(url))) {
      return nextLoad(url, context);
    }
    return {
      format: 'module-typescript',
      source: render(fileURLToPath(url)),
      shortCircuit: true,
    };
  },
});
