import { Command } from 'commander';
import { execa } from 'execa';
import { execSync } from 'node:child_process';

import { generate } from '@sdk-it/dart';
import { loadSpec } from '@sdk-it/spec';

import {
  outputOption,
  parseDotConfig,
  parsePagination,
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
  .option('-n, --name <name>', 'Name of the generated client', 'Client')
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
        ? parsePagination(parseDotConfig(options.pagination ?? 'true'))
        : options.pagination,
    formatCode: async ({ output }) => {
      if (options.formatter) {
        const [command, ...args] = options.formatter.split(' ');
        await execa(command, args, {
          env: { ...process.env, SDK_IT_OUTPUT: output },
        });
      } else {
        execSync(`dart format ${shellEnv('SDK_IT_OUTPUT')}`, {
          env: { ...process.env, SDK_IT_OUTPUT: output },
          stdio: options.verbose ? 'inherit' : 'pipe',
        });
        // execSync('dart fix --apply $SDK_IT_OUTPUT ', {
        //   env: { ...process.env, SDK_IT_OUTPUT: output },
        //   stdio: options.verbose ? 'inherit' : 'pipe',
        // });
      }
    },
  });
}
