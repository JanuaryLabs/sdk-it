import { Command } from 'commander';
import { execFile, execSync } from 'node:child_process';

import { generate } from '@sdk-it/dart';
import { loadSpec } from '@sdk-it/spec';

import {
  outputOption,
  parseDotConfig,
  parsePagination,
  shellEnv,
  specOption,
} from '../options.ts';

interface Options {
  spec: string;
  output: string;
  language: string;
  mode?: 'full' | 'minimal';
  name?: string;
  useTsExtension: boolean;
  /**
   * Command to run the formatter.
   * @example 'biome check $SDK_IT_OUTPUT --write'
   * @example 'prettier $SDK_IT_OUTPUT --write'
   */
  formatter?: string;
  verbose: boolean;
  pagination?: string;
}

export default new Command('dart')
  .description('Generate Dart SDK')
  .addOption(specOption.makeOptionMandatory(true))
  .addOption(outputOption.makeOptionMandatory(true))
  .option('-l, --language <language>', 'Programming language for the SDK')
  // .option(
  //   '-m, --mode <mode>',
  //   'full: generate a full project including package.json and tsconfig.json. useful for monorepo/workspaces minimal: generate only the client sdk',
  // )
  .option('-n, --name <name>', 'Name of the generated client', 'Client')
  .option(
    '--pagination <pagination>',
    'Configure pagination (e.g., "false", "true", "guess=false")',
    'true',
  )
  .option('-v, --verbose', 'Verbose output', false)
  // .option('--formatter <formatter>', 'Formatter to use for the generated code')
  .action(async (options: Options) => {
    await runDart(options);
  });

export async function runDart(options: Options) {
  await generate(await loadSpec(options.spec), {
    output: options.output,
    mode: options.mode || 'full',
    name: options.name,
    pagination: parsePagination(parseDotConfig(options.pagination ?? 'true')),
    formatCode: ({ output }) => {
      if (options.formatter) {
        const [command, ...args] = options.formatter.split(' ');
        execFile(command, args, {
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
