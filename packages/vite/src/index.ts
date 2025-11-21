import chalk from 'chalk';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { OpenAPIObject } from 'openapi3-ts/oas31';
import { type Plugin } from 'vite';

import { loadSpec } from '@sdk-it/spec';
import { generate } from '@sdk-it/typescript';

type Settings = Parameters<typeof generate>[1];
type OpenapiFunction = () =>
  | string
  | OpenAPIObject
  | Promise<string | OpenAPIObject>;

export default function sdkIt(
  openapi: OpenAPIObject | string | OpenapiFunction,
  settings: Settings,
): Plugin {
  return {
    name: 'sdk-it',
    ...(typeof openapi === 'function'
      ? functionPlugin(openapi, settings)
      : typeof openapi === 'string'
        ? filePlugin(openapi, settings)
        : specPlugin(openapi, settings)),
  };
}

function functionPlugin(
  openapi: OpenapiFunction,
  settings: Settings,
): Omit<Plugin, 'name'> {
  let delegatePlugin!:
    | ReturnType<typeof specPlugin>
    | ReturnType<typeof filePlugin>;

  return {
    async configResolved(config) {
      // Resolve the function once
      const resolved = await openapi();

      // Create the appropriate delegate plugin based on the resolved type
      delegatePlugin =
        typeof resolved === 'string'
          ? filePlugin(resolved, settings)
          : specPlugin(resolved, settings);

      return (delegatePlugin.configResolved as any)?.(config);
    },
    configureServer(server) {
      return (delegatePlugin.configureServer as any)?.(server);
    },
    async buildStart(options) {
      return (delegatePlugin.buildStart as any)?.(options);
    },
  };
}

function filePlugin(openapi: string, settings: Settings): Omit<Plugin, 'name'> {
  let watchPath: string | null = null;
  let sourceRef: string | null = null;

  const generateOnce = onceAtATime(async (ref: string) => {
    console.log(`${chalk.blue('SDKIT')}: Generating SDK.`);
    const spec = await loadSpec(ref);
    await generate(spec, settings);
    console.log(`${chalk.blue('SDKIT')}: SDK generated successfully.`);
  });

  return {
    configureServer(server) {
      if (!sourceRef) return;

      if (!watchPath) return;
      // Watch only when we have a real filesystem path
      console.log(
        `${chalk.blue('SDKIT')}: Watching for spec changes in`,
        watchPath,
      );
      server.watcher.add(watchPath);
      server.watcher.on('change', async (file) => {
        if (file === watchPath) {
          console.log(`${chalk.blue('SDKIT')}: OpenAPI spec changed`, file);
          await generateOnce(sourceRef!);
        }
      });
    },
    async buildStart() {
      if (!sourceRef) return;
      await generateOnce(sourceRef);
    },
    async configResolved(config) {
      if (startsWithProtocol(openapi)) {
        if (openapi.startsWith('file:')) {
          watchPath = fileURLToPath(openapi);
          sourceRef = openapi;
        }
      } else {
        watchPath = join(config.root, openapi);
        sourceRef = join(config.root, openapi);
      }
    },
  };
}

function specPlugin(
  openapi: OpenAPIObject,
  settings: Settings,
): Omit<Plugin, 'name'> {
  const generateOnce = onceAtATime(async (spec: OpenAPIObject) => {
    console.log(`${chalk.blue('SDKIT')}: Generating SDK.`);
    await generate(spec, settings);
    console.log(`${chalk.blue('SDKIT')}: SDK generated successfully.`);
  });
  return {
    async configResolved() {
      // No-op for specPlugin
    },
    async configureServer() {
      await generateOnce(openapi);
    },
    async buildStart() {
      await generateOnce(openapi);
    },
  };
}

/**
 * Ensures that an async function has only one execution at a time (prevents concurrent calls).
 * If called while already executing, subsequent calls will wait for the current execution to complete
 * and receive the same result.
 * @param fn The async function to serialize.
 */
export function onceAtATime<TArgs extends readonly unknown[], TReturn>(
  fn: (...args: TArgs) => Promise<TReturn>,
): (...args: TArgs) => Promise<TReturn> {
  let current: Promise<TReturn> | null = null;

  return function (...args: TArgs): Promise<TReturn> {
    if (current) {
      // Return the existing promise if already executing
      return current;
    }

    // Start new execution
    current = (async () => {
      try {
        return await fn(...args);
      } finally {
        // Clear the current execution when done
        current = null;
      }
    })();

    return current;
  };
}

function startsWithProtocol(url: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//.test(url);
}
