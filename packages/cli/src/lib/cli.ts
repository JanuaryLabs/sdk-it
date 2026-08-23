#!/usr/bin/env node
import { Command, program } from 'commander';

import init from './commands/init.ts';
import apiref from './generators/apiref.ts';
import dart from './generators/dart.ts';
import python from './generators/python.ts';
import readme from './generators/readme.ts';
import typescript from './generators/typescript.ts';
import { generateProject, loadProjectConfig } from './project.ts';

interface Options {
  config?: string;
}

const generate = new Command('generate')
  .description('Generate SDKs from configuration or OpenAPI')
  .option('-c, --config <path>', 'Path to an SDK-IT configuration file')
  .action(async (options: Options) => {
    const config = await loadProjectConfig({ config: options.config });
    await generateProject(config);
    console.log('Client generated successfully!');
  })
  .addCommand(typescript)
  .addCommand(python)
  .addCommand(dart)
  .addCommand(apiref)
  .addCommand(readme);

const cli = program
  .name('sdk-it')
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
