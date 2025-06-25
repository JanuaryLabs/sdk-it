#!/usr/bin/env node
import { Command, program } from 'commander';

import apiref from './apiref.ts';
import dart from './langs/dart.ts';
import python from './langs/python.ts';
import typescript from './langs/typescript.ts';

const generate = new Command('generate')
  .addCommand(typescript)
  .addCommand(python)
  .addCommand(dart)
  .addCommand(apiref);
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
