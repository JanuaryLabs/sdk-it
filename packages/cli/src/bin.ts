#!/usr/bin/env node
import cli from './lib/cli.ts';

await cli.parseAsync(process.argv);
