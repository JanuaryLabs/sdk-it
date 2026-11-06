import crypto from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { styleText } from 'node:util';
import type { OpenAPIObject } from 'openapi3-ts/oas31';
import {
  type FSWatcher,
  type Plugin,
  type ResolvedConfig,
  type ViteDevServer,
  normalizePath,
} from 'vite';

import { loadSpec } from '@sdk-it/spec';
import { generate } from '@sdk-it/typescript';

import { type ProjectPluginOptions, projectPlugin } from './project.ts';

const sdkit = styleText('blue', 'SDKIT');

type Settings = Parameters<typeof generate>[1];
interface SourcePlugin {
  configResolved(config: ResolvedConfig): Promise<void>;
  configureServer(server: ViteDevServer): Promise<void>;
  buildStart(): Promise<void>;
}
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
  if (typeof openapi === 'function') {
    return { name: 'sdk-it', ...functionPlugin(openapi, settings!) };
  }
  if (typeof openapi === 'string') {
    return { name: 'sdk-it', ...filePlugin(openapi, settings!) };
  }
  return { name: 'sdk-it', ...specPlugin(openapi, settings!) };
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
  let delegatePlugin!: SourcePlugin;

  return {
    async configResolved(config) {
      const resolved = await openapi();
      delegatePlugin =
        typeof resolved === 'string'
          ? filePlugin(resolved, settings)
          : specPlugin(resolved, settings);

      return delegatePlugin.configResolved(config);
    },
    configureServer(server) {
      return delegatePlugin.configureServer(server);
    },
    async buildStart() {
      return delegatePlugin.buildStart();
    },
  };
}

function filePlugin(openapi: string, settings: Settings): SourcePlugin {
  // Vite resolves the config before it starts a dev server or a build.
  const source = Promise.withResolvers<{ ref: string; watchPath?: string }>();
  // Only a dev server has a watcher; a build never resolves this.
  const devWatcher = Promise.withResolvers<FSWatcher>();
  // Every local file the spec was read from; an edit to any of them regenerates.
  let watched = new Set<string>();
  let loads = 0;

  const watch = (documents: string[]) => {
    watched = new Set(
      documents
        .filter((document) => document.startsWith('file:'))
        .map((document) => normalizePath(fileURLToPath(document))),
    );
    void devWatcher.promise.then((watcher) => watcher.add([...watched]));
  };

  const generateIfNeeded = async (ref: string) => {
    const load = ++loads;
    const { spec, documents } = await loadSpec(ref);
    if (load === loads) watch(documents);
    return cachedGeneration(settings.output, hashSpec(spec), async () => {
      console.log(`${sdkit}: Generating SDK.`);
      await generate(spec, settings);
      console.log(`${sdkit}: SDK generated successfully.`);
    });
  };

  return {
    async configureServer(server) {
      const { ref, watchPath } = await source.promise;
      if (!watchPath) return;
      console.log(`${sdkit}: Watching for spec changes in`, watchPath);
      server.watcher.add([...watched]);
      devWatcher.resolve(server.watcher);
      const regenerate = (file: string) => {
        if (!watched.has(normalizePath(file))) return;
        console.log(`${sdkit}: OpenAPI spec changed`, file);
        // A half-saved file fails to load; the next save tries again.
        generateIfNeeded(ref).catch((error: unknown) =>
          console.error(
            `${styleText('red', 'SDKIT', { stream: process.stderr })}: SDK generation failed.`,
            error,
          ),
        );
      };
      server.watcher.on('change', regenerate);
      server.watcher.on('add', regenerate);
    },
    async buildStart() {
      const { ref } = await source.promise;
      await generateIfNeeded(ref);
    },
    async configResolved(config) {
      const ref = startsWithProtocol(openapi)
        ? openapi
        : join(config.root, openapi);
      let watchPath: string | undefined;
      if (!startsWithProtocol(openapi)) {
        watchPath = ref;
      } else if (openapi.startsWith('file:')) {
        watchPath = fileURLToPath(openapi);
      }
      if (watchPath) watched = new Set([normalizePath(watchPath)]);
      source.resolve({ ref, watchPath });
    },
  };
}

function specPlugin(openapi: OpenAPIObject, settings: Settings): SourcePlugin {
  const generateIfNeeded = async (document: OpenAPIObject) => {
    const spec = structuredClone(document);
    return cachedGeneration(settings.output, hashSpec(spec), async () => {
      console.log(`${sdkit}: Generating SDK.`);
      await generate(spec, settings);
      console.log(`${sdkit}: SDK generated successfully.`);
    });
  };
  return {
    async configResolved() {},
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
  return crypto.hash('sha256', JSON.stringify(spec));
}

function startsWithProtocol(url: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//.test(url);
}
