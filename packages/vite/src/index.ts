import chalk from 'chalk';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Plugin } from 'vite';

import { loadSpec } from '@sdk-it/spec';
import { generate } from '@sdk-it/typescript';

export default function sdkIt(
  openapi: string,
  settings: Parameters<typeof generate>[1],
): Plugin {
  let watchPath: string | null = null;
  let sourceRef: string | null = null;

  const generateOnce = onceAtATime(async (ref: string) => {
    console.log(`${chalk.blue('SDKIT')}: Generating SDK.`);
    const spec = await loadSpec(ref);
    await generate(spec, settings);
    console.log(`${chalk.blue('SDKIT')}: SDK generated successfully.`);
  });

  return {
    name: 'sdk-it',
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
