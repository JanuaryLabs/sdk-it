import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';
import { compileFunction } from 'node:vm';
import { parentPort } from 'node:worker_threads';
import * as z from 'zod';

import type {
  Binding,
  EvaluationReply,
  EvaluationRequest,
} from './zod-evaluation-protocol.js';
import { convertZodSchema } from './zod-to-json-schema.js';

// The thread a ZodEvaluator starts: it resolves and loads the analyzed
// project's modules with the project's customConditions, and converts each
// against there.

if (!('toJSONSchema' in z)) {
  throw new Error(
    '@sdk-it/core requires Zod 4. Install zod@^4.6.7 and migrate Zod 3 schemas before analysis.',
  );
}

const resolved = new Map<string, string>();

/** Resolves each specifier and referrer pair once. */
function resolve(specifier: string, referrer: string): string {
  const key = JSON.stringify([specifier, referrer]);
  let url = resolved.get(key);
  if (url === undefined) {
    url = import.meta.resolve(specifier, referrer);
    resolved.set(key, url);
  }
  return url;
}

async function importModule(url: string): Promise<unknown> {
  try {
    return await import(url);
  } catch (error) {
    // Node names this thread's file as the importer; the module itself is missing.
    if (
      Error.isError(error) &&
      Reflect.get(error, 'code') === 'ERR_MODULE_NOT_FOUND' &&
      Reflect.get(error, 'url') === url
    ) {
      throw new Error(`Cannot find module '${fileURLToPath(url)}'`, {
        cause: error,
      });
    }
    throw error;
  }
}

async function load(binding: Binding): Promise<unknown> {
  const module = await importModule(binding.from);
  if (binding.property === undefined) {
    return module;
  }
  if (!(typeof module === 'object' && module && binding.property in module)) {
    throw new Error(
      `${binding.from} does not export ${binding.property}, which ${binding.import} names`,
    );
  }
  return Reflect.get(module, binding.property);
}

async function evaluate(against: string, imports: readonly Binding[]) {
  const values = await Promise.all(imports.map(load));
  // The newlines keep a trailing line comment from swallowing the parenthesis.
  const expression = stripTypeScriptTypes(`(\n${against}\n)`);
  const build = compileFunction(`return ${expression};`, [
    'z',
    ...imports.map((binding) => binding.import),
  ]);
  return convertZodSchema(Reflect.apply(build, undefined, [z, ...values]));
}

async function handle(request: EvaluationRequest): Promise<EvaluationReply> {
  try {
    if (request.kind === 'resolve') {
      return {
        id: request.id,
        kind: 'resolved',
        url: resolve(request.specifier, request.referrer),
      };
    }
    if (request.kind === 'load') {
      await Promise.all(request.imports.map(load));
      return { id: request.id, kind: 'loaded' };
    }
    return {
      id: request.id,
      kind: 'evaluated',
      result: await evaluate(request.against, request.imports),
    };
  } catch (error) {
    return { id: request.id, kind: 'failed', error };
  }
}

parentPort?.on('message', (request: EvaluationRequest) => {
  void handle(request).then((reply) => {
    try {
      parentPort?.postMessage(reply);
    } catch (cloneError) {
      // The error held a value postMessage cannot clone.
      const failure = reply.kind === 'failed' ? reply.error : cloneError;
      parentPort?.postMessage({
        id: reply.id,
        kind: 'failed',
        error: new Error(
          Error.isError(failure) ? failure.message : String(failure),
        ),
      } satisfies EvaluationReply);
    }
  });
});
