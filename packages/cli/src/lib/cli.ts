#!/usr/bin/env node
import { Command, program } from 'commander';

import { readJson } from '@sdk-it/core/file-system.js';

import init from './commands/init.ts';
import apiref from './generators/apiref.ts';
import dart, { runDart } from './generators/dart.ts';
import python, { runPython } from './generators/python.ts';
import readme, { runReadme } from './generators/readme.ts';
import typescript, { runTypescript } from './generators/typescript.ts';
import type { SdkConfig } from './types.ts';

interface Options {
  config?: string;
}

const generate = new Command('generate')
  .action(async (options: Options) => {
    options.config ??= 'sdk-it.json';
    const config = await readJson<SdkConfig>(options.config);

    const promises: Promise<unknown>[] = [];

    if (config.generators?.typescript) {
      promises.push(
        runTypescript({
          spec: config.generators.typescript.spec,
          output: config.generators.typescript.output,
          mode: config.generators.typescript.mode,
          name: config.generators.typescript.name,
          useTsExtension: config.generators.typescript.useTsExtension ?? true,
          install: config.generators.typescript.install ?? false,
          verbose: false,
          defaultFormatter:
            config.generators.typescript.defaultFormatter ?? true,
          outputType: 'default',
          readme: config.generators.typescript.readme ?? true,
          pagination: config.generators.typescript.pagination,
        }),
      );
    }

    if (config.generators?.python) {
      promises.push(
        runPython({
          spec: config.generators.python.spec,
          output: config.generators.python.output,
          mode: config.generators.python.mode,
          name: config.generators.python.name,
          verbose: false,
        }),
      );
    }

    if (config.generators?.dart) {
      promises.push(
        runDart({
          spec: config.generators.dart.spec,
          output: config.generators.dart.output,
          mode: config.generators.dart.mode,
          name: config.generators.dart.name,
          verbose: false,
          pagination: config.generators.dart.pagination,
        }),
      );
    }

    // if (config.apiref) {
    //   promises.push(runApiRef(config.apiref.spec, config.apiref.output));
    // }

    if (config.readme) {
      promises.push(runReadme(config.readme.spec, config.readme.output));
    }

    await Promise.all(promises);
    console.log('All configured generators completed successfully!');
  })
  .addCommand(typescript)
  .addCommand(python)
  .addCommand(dart)
  .addCommand(apiref)
  .addCommand(readme);

const cli = program
  .description(`CLI tool to interact with SDK-IT.`)
  .addCommand(generate, { isDefault: true })
  .addCommand(init)
  .addCommand(
    new Command('_internal').action(() => {
      // do nothing
    }),
    { hidden: true },
  )
  .parse(process.argv);

export default cli;
