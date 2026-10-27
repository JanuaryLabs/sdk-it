import chalk from 'chalk';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { OpenAPIObject } from 'openapi3-ts/oas31';
import { type FSWatcher, type Plugin, normalizePath } from 'vite';

import { loadSpec } from '@sdk-it/spec';
import { generate } from '@sdk-it/typescript';

import { type ProjectPluginOptions, projectPlugin } from './project.ts';

type Settings = Parameters<typeof generate>[1];
type OpenapiFunction = () =>
  string | OpenAPIObject | Promise<string | OpenAPIObject>;
export default function sdkIt(): Plugin;
export default function sdkIt(options: ProjectPluginOptions): Plugin;
export default function sdkIt(
  openapi: OpenAPIObject | string | OpenapiFunction,
  settings: Settings,
): Plugin;
export default function sdkIt(
  openapi?: OpenAPIObject | string | OpenapiFunction | ProjectPluginOptions,
  settings?: Settings,
): Plugin {
  if (openapi === undefined || isProjectPluginOptions(openapi)) {
    return {
      name: 'sdk-it',
      ...projectPlugin(openapi),
    };
  }
  return {
    name: 'sdk-it',
    ...(typeof openapi === 'function'
      ? functionPlugin(openapi, settings!)
      : typeof openapi === 'string'
        ? filePlugin(openapi, settings!)
        : specPlugin(openapi, settings!)),
  };
}

function isProjectPluginOptions(
  input: OpenAPIObject | string | OpenapiFunction | ProjectPluginOptions,
): input is ProjectPluginOptions {
  return typeof input === 'object' && input !== null && !('openapi' in input);
}

function functionPlugin(
  openapi: OpenapiFunction,
  settings: Settings,
): Omit<Plugin, 'name'> {
  let delegatePlugin!:
    ReturnType<typeof specPlugin> | ReturnType<typeof filePlugin>;

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
  let watcher: FSWatcher | undefined;
  // Every local file the spec was read from; an edit to any of them regenerates.
  let watched = new Set<string>();
  let loads = 0;

  const watch = (documents: string[]) => {
    watched = new Set(
      documents
        .filter((document) => document.startsWith('file:'))
        .map((document) => normalizePath(fileURLToPath(document))),
    );
    watcher?.add([...watched]);
  };

  const generateIfNeeded = async (ref: string) => {
    const load = ++loads;
    const { spec, documents } = await loadSpec(ref);
    if (load === loads) watch(documents);
    return cachedGeneration(settings.output, hashSpec(spec), async () => {
      console.log(`${chalk.blue('SDKIT')}: Generating SDK.`);
      await generate(spec, settings);
      console.log(`${chalk.blue('SDKIT')}: SDK generated successfully.`);
    });
  };

  return {
    configureServer(server) {
      const ref = sourceRef;
      if (!ref) return;

      if (!watchPath) return;
      console.log(
        `${chalk.blue('SDKIT')}: Watching for spec changes in`,
        watchPath,
      );
      watcher = server.watcher;
      watcher.add([...watched]);
      const regenerate = (file: string) => {
        if (!watched.has(normalizePath(file))) return;
        console.log(`${chalk.blue('SDKIT')}: OpenAPI spec changed`, file);
        // A half-saved file fails to load; the next save tries again.
        generateIfNeeded(ref).catch((error: unknown) =>
          console.error(`${chalk.red('SDKIT')}: SDK generation failed.`, error),
        );
      };
      watcher.on('change', regenerate);
      watcher.on('add', regenerate);
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
      if (watchPath) watched = new Set([normalizePath(watchPath)]);
    },
  };
}

function specPlugin(
  openapi: OpenAPIObject,
  settings: Settings,
): Omit<Plugin, 'name'> {
  const generateIfNeeded = async (document: OpenAPIObject) => {
    const spec = structuredClone(document);
    return cachedGeneration(settings.output, hashSpec(spec), async () => {
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

const generationCache = new Map<
  string,
  { hash: string; promise: Promise<void> }
>();

function cachedGeneration(
  output: string,
  hash: string,
  fn: () => Promise<void>,
): Promise<void> {
  const key = resolve(output);
  const existing = generationCache.get(key);
  // Only the latest queued generation can represent this output directory.
  if (existing?.hash === hash) return existing.promise;

  // A failed predecessor still releases the queue; its own caller keeps the error.
  const promise: Promise<void> = (
    existing ? existing.promise.then(fn, fn) : fn()
  ).catch((err) => {
    if (generationCache.get(key)?.promise === promise)
      generationCache.delete(key);
    throw err;
  });
  generationCache.set(key, { hash, promise });
  return promise;
}

function hashSpec(spec: OpenAPIObject): string {
  return createHash('sha256').update(JSON.stringify(spec)).digest('hex');
}

function startsWithProtocol(url: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//.test(url);
}
