import { Command } from 'commander';
import { execFile, execSync } from 'node:child_process';

import { generate } from '@sdk-it/dart';

import { loadSpec } from '../loader.ts';
import { outputOption, specOption } from '../options.ts';

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
  .option('-v, --verbose', 'Verbose output', false)
  // .option('--formatter <formatter>', 'Formatter to use for the generated code')
  .action(async (options: Options) => {
    const spec = await loadSpec(options.spec);
    await generate(spec, {
      output: options.output,
      mode: options.mode || 'minimal',
      name: options.name,
      formatCode: ({ env, output }) => {
        if (options.formatter) {
          const [command, ...args] = options.formatter.split(' ');
          execFile(command, args, { env: { ...env, SDK_IT_OUTPUT: output } });
        } else {
          execSync('dart format $SDK_IT_OUTPUT', {
            env: { ...process.env, SDK_IT_OUTPUT: output },
            stdio: options.verbose ? 'inherit' : 'pipe',
          });
        }
      },
    });
  });
