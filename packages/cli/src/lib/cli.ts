#!/usr/bin/env node
import { Command, program } from 'commander';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import apiref, { runApiRef } from './generators/apiref.ts';
import dart, { runDart } from './generators/dart.ts';
import python, { runPython } from './generators/python.ts';
import readme from './generators/readme.ts';
import typescript, { runTypescript } from './generators/typescript.ts';

interface SdkConfig {
  readme?: {
    spec: string;
    output: string;
  };
  apiref?: {
    spec: string;
    output: string;
  };
  generators: {
    typescript?: {
      spec: string;
      output: string;
      mode?: 'full' | 'minimal';
      name?: string;
      pagination?: boolean;
    };
    python?: {
      spec: string;
      output: string;
      mode?: 'full' | 'minimal';
      name?: string;
    };
    dart?: {
      spec: string;
      output: string;
      mode?: 'full' | 'minimal';
      name?: string;
      pagination?: boolean;
    };
  };
}

interface Options {
  config?: string;
}

const generate = new Command('generate')
  .action(async (options: Options) => {
    options.config ??= 'sdk-it.json';
    const config = await readFile(options.config, 'utf-8').then(
      (data) => JSON.parse(data) as SdkConfig,
    );

    const promises: Promise<unknown>[] = [];

    if (config.generators?.typescript) {
      promises.push(
        runTypescript({
          spec: config.generators.typescript.spec,
          output: config.generators.typescript.output,
          mode: config.generators.typescript.mode,
          name: config.generators.typescript.name,
          language: 'typescript',
          useTsExtension: true,
          install: true,
          verbose: false,
          defaultFormatter: true,
          outputType: 'default',
          errorAsValue: false,
          readme: true,
          pagination: config.generators.typescript.pagination?.toString(),
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
          language: 'python',
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
          language: 'dart',
          useTsExtension: false,
          verbose: false,
          pagination: config.generators.dart.pagination?.toString(),
        }),
      );
    }

    // if (config.apiref) {
    //   promises.push(runApiRef(config.apiref.spec, config.apiref.output));
    // }

    // if (config.readme) {
    //   promises.push(runReadme(config.readme.spec, config.readme.output));
    // }

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
  .addCommand(
    new Command('_internal').action(() => {
      // do nothing
    }),
    { hidden: true },
  )
  .parse(process.argv);

export default cli;
