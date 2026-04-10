import chalk from 'chalk';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
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

  const generateIfNeeded = async (ref: string) => {
    const hash = await hashFile(watchPath || ref);
    const key = `${hash}|${settings.output}`;
    return cachedGeneration(key, async () => {
      console.log(`${chalk.blue('SDKIT')}: Generating SDK.`);
      const spec = await loadSpec(ref);
      await generate(spec, settings);
      console.log(`${chalk.blue('SDKIT')}: SDK generated successfully.`);
    });
  };

  return {
    configureServer(server) {
      if (!sourceRef) return;

      if (!watchPath) return;
      console.log(
        `${chalk.blue('SDKIT')}: Watching for spec changes in`,
        watchPath,
      );
      server.watcher.add(watchPath);
      server.watcher.on('change', async (file) => {
        if (file === watchPath) {
          console.log(`${chalk.blue('SDKIT')}: OpenAPI spec changed`, file);
          await generateIfNeeded(sourceRef!);
        }
      });
    },
    async buildStart() {
      if (!sourceRef) return;
      await generateIfNeeded(sourceRef);
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
  const generateIfNeeded = async (spec: OpenAPIObject) => {
    const hash = hashSpec(spec);
    const key = `${hash}|${settings.output}`;
    return cachedGeneration(key, async () => {
      console.log(`${chalk.blue('SDKIT')}: Generating SDK.`);
      await generate(spec, settings);
      console.log(`${chalk.blue('SDKIT')}: SDK generated successfully.`);
    });
  };
  return {
    async configResolved() {
      // No-op for specPlugin
    },
    async configureServer() {
      await generateIfNeeded(openapi);
    },
    async buildStart() {
      await generateIfNeeded(openapi);
    },
  };
}

const generationCache = new Map<string, Promise<void>>();

function cachedGeneration(
  key: string,
  fn: () => Promise<void>,
): Promise<void> {
  const existing = generationCache.get(key);
  if (existing) return existing;

  const promise = fn().catch((err) => {
    generationCache.delete(key);
    throw err;
  });
  generationCache.set(key, promise);
  return promise;
}

function hashFile(filePath: string): Promise<string> {
  return readFile(filePath).then((content) =>
    createHash('sha256').update(content).digest('hex'),
  );
}

function hashSpec(spec: OpenAPIObject): string {
  return createHash('sha256').update(JSON.stringify(spec)).digest('hex');
}

function startsWithProtocol(url: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//.test(url);
}
