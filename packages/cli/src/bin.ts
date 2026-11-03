#!/usr/bin/env node
import cli from './lib/cli.ts';
import './startup.ts';

await cli.parseAsync(process.argv);
