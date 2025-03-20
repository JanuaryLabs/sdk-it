#!/usr/bin/env node
import { Command, program } from 'commander';

import dart from './langs/dart';
import typescript from './langs/typescript';

const generate = new Command('generate')
  .addCommand(typescript)
  .addCommand(dart);
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
