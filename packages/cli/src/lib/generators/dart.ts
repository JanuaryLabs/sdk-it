import { Command } from 'commander';
import { execSync } from 'node:child_process';

import { generate } from '@sdk-it/dart';
import { loadSpec } from '@sdk-it/spec';

import {
  outputOption,
  parseDotConfig,
  parsePagination,
  runFormatter,
  shellEnv,
  specOption,
} from '../options.ts';
import type { DartOptions } from '../types.ts';

type Options = Omit<DartOptions, 'pagination'> & {
  output: string;
  pagination?: DartOptions['pagination'] | string;
};
export default new Command('dart')
  .description('Generate Dart SDK')
  .addOption(specOption.makeOptionMandatory(true))
  .addOption(outputOption.makeOptionMandatory(true))
  .requiredOption('-n, --name <name>', 'Name of the generated client')
  .option(
    '--pagination <pagination>',
    'Configure pagination (e.g., "false", "true", "guess=false")',
    'true',
  )
  .option('-v, --verbose', 'Verbose output', false)
  .option('--formatter <formatter>', 'Formatter to use for the generated code')
  .action(async (options: Options) => {
    await runDart(options);
  });

async function runDart(options: Options) {
  await generate((await loadSpec(options.spec)).spec, {
    output: options.output,
    mode: options.mode || 'full',
    name: options.name,
    pagination:
      typeof options.pagination === 'string'
        ? parsePagination(parseDotConfig(options.pagination))
        : options.pagination,
    formatCode: ({ output }) => {
      if (options.formatter) {
        runFormatter(options.formatter, output, process.env);
      } else {
        execSync(`dart format ${shellEnv('SDK_IT_OUTPUT')}`, {
          env: { ...process.env, SDK_IT_OUTPUT: output },
          stdio: options.verbose ? 'inherit' : 'pipe',
        });
      }
    },
  });
}
