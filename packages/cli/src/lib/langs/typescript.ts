import { Command } from 'commander';
import { execFile, execSync, spawnSync } from 'node:child_process';

import { writeFiles } from '@sdk-it/core/file-system.js';
import { loadSpec } from '@sdk-it/spec';
import { generate } from '@sdk-it/typescript';

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
  framework?: string;
  install: boolean;
  verbose: boolean;
  defaultFormatter: boolean;
  outputType?: 'default' | 'status';
  errorAsValue?: boolean;
  readme?: boolean;
}

export default new Command('typescript')
  .alias('ts')
  .description('Generate TypeScript SDK')
  .addOption(specOption.makeOptionMandatory(true))
  .addOption(outputOption.makeOptionMandatory(true))
  .option(
    '--useTsExtension [value]',
    'Use .ts extension for generated files',
    (value) => (value === 'false' ? false : true),
    true,
  )
  .option('-l, --language <language>', 'Programming language for the SDK')
  .option(
    '-m, --mode <mode>',
    'full: generate a full project including package.json and tsconfig.json. useful for monorepo/workspaces minimal: generate only the client sdk',
  )
  .option('-n, --name <name>', 'Name of the generated client', 'Client')
  .option(
    '-f, --framework <framework>',
    'Framework that is integrating with the SDK',
  )
  .option('--formatter <formatter>', 'Formatter to use for the generated code')
  .option(
    '--install',
    'Install dependencies using npm (only in full mode)',
    true,
  )
  .option('--readme <readme>', 'Generate a README file', (value) =>
    value === 'false' ? false : true,
  )
  .option('--output-type <outputType>', 'Endpoint output type', 'default')
  .option(
    '--error-as-value <errorAsValue>',
    'Treat errors as values instead of throwing them',
    (value) => (value === 'false' ? false : true),
    false,
  )
  .option('--no-default-formatter', 'Do not use the default formatter')
  .option('--no-install', 'Do not install dependencies')
  .option('-v, --verbose', 'Verbose output', false)
  .action(async (options: Options) => {
    const spec = await loadSpec(options.spec);
    await generate(spec, {
      writer: writeFiles,
      output: options.output,
      mode: options.mode || 'minimal',
      name: options.name,
      style: {
        name: 'github',
        outputType: options.outputType,
        errorAsValue: options.errorAsValue,
      },
      readme: options.readme,
      useTsExtension: options.useTsExtension,
      formatCode: ({ env, output }) => {
        if (options.formatter) {
          const [command, ...args] = options.formatter.split(' ');
          execFile(command, args, {
            env: { ...env, SDK_IT_OUTPUT: output },
          });
        } else if (options.defaultFormatter) {
          spawnSync('npx', ['-y', 'prettier', output, '--write'], {
            env: {
              ...env,
              SDK_IT_OUTPUT: output,
              NODE_OPTIONS: '--experimental-strip-types',
            },
            stdio: options.verbose ? 'inherit' : 'pipe',
          });
        }
      },
    });

    // Install dependencies if in full mode and install option is enabled
    if (options.install && options.mode === 'full') {
      console.log('Installing dependencies...');
      execSync('npm install', {
        cwd: options.output,
        stdio: options.verbose ? 'inherit' : 'pipe',
      });
    }
  });
