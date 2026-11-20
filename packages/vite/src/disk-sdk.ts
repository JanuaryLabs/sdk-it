import { Future } from '@zukhruf/async';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { styleText } from 'node:util';
import type { OpenAPIObject } from 'openapi3-ts/oas31';
import { type FSWatcher, type Plugin, type Rollup, normalizePath } from 'vite';

import { generate } from '@sdk-it/typescript';

import { OutputFolder } from './output-folder.ts';
import type { ConfiguredSpec, SpecSource } from './spec-source.ts';

export type DiskSdkSettings = Parameters<typeof generate>[1];

const sdkit = styleText('blue', 'SDKIT');

/**
 * Generates an SDK into a folder on disk at the start of a build or a dev
 * server, and again in dev when a local document of the spec changes.
 */
export class DiskSdk {
  readonly #source: SpecSource;
  readonly #settings: DiskSdkSettings;
  readonly #output: OutputFolder;
  readonly #configured = new Future<ConfiguredSpec>();
  /** The dev server's watcher; a build never has one. */
  readonly #watcher = new Future<FSWatcher>();
  /** Every local file the spec was read from; an edit to any of them regenerates. */
  #watched = new Set<string>();
  #loads = 0;

  constructor(source: SpecSource, settings: DiskSdkSettings) {
    this.#source = source;
    this.#settings = settings;
    this.#output = new OutputFolder(settings.output);
  }

  toPlugin(): Plugin {
    const configure = async (root: string) => {
      try {
        this.#configured.resolve(await this.#source.configure(root));
      } catch (error) {
        this.#configured.reject(error);
        throw error;
      }
    };
    const serve = async (watcher: FSWatcher) => {
      this.#watcher.resolve(watcher);
      return (await this.#configured.wait()).watchPath;
    };
    const generate = (context: Rollup.PluginContext) => this.#generate(context);
    const watches = (id: string) => this.#watched.has(normalizePath(id));
    return {
      name: 'sdk-it',
      async configResolved(config) {
        await configure(config.root);
      },
      async configureServer(server) {
        const watchPath = await serve(server.watcher);
        if (watchPath) {
          console.log(`${sdkit}: Watching for spec changes in`, watchPath);
        }
      },
      async buildStart() {
        await generate(this);
      },
      watchChange(id, { event }) {
        if (event === 'delete' || !watches(id)) return;
        console.log(`${sdkit}: OpenAPI spec changed`, id);
        // A half-saved file fails to load; the next save tries again.
        generate(this).catch((error: unknown) =>
          console.error(
            `${styleText('red', 'SDKIT', { stream: process.stderr })}: SDK generation failed.`,
            error,
          ),
        );
      },
    };
  }

  async #generate(context: Rollup.PluginContext) {
    const load = ++this.#loads;
    const { spec, documents } = await (await this.#configured.wait()).load();
    if (load === this.#loads) this.#watch(context, documents);
    return this.#output.generate(hashSpec(spec), async () => {
      console.log(`${sdkit}: Generating SDK.`);
      await generate(spec, this.#settings);
      console.log(`${sdkit}: SDK generated successfully.`);
    });
  }

  #watch(context: Rollup.PluginContext, documents: readonly string[]) {
    this.#watched = new Set(
      documents
        .filter((document) => document.startsWith('file:'))
        .map((document) => normalizePath(fileURLToPath(document))),
    );
    for (const file of this.#watched) {
      context.addWatchFile(file);
      // Vite watches a file outside its root only when the file exists
      // (ensureWatchedFile), so a referenced file that does not exist yet is
      // added to the dev server's watcher here, and creating it regenerates.
      void this.#watcher.wait().then((watcher) => watcher.add(file));
    }
  }
}

function hashSpec(spec: OpenAPIObject): string {
  return crypto.hash('sha256', JSON.stringify(spec));
}
