import { Command } from 'commander';
import { execFile, execSync } from 'node:child_process';

import { generate } from '@sdk-it/python';
import { loadSpec, toIR } from '@sdk-it/spec';

import { outputOption, shellEnv, specOption } from '../options.ts';
import type { PythonOptions } from '../types.ts';

export default new Command('python')
  .description('Generate Python SDK')
  .addOption(specOption.makeOptionMandatory(true))
  .addOption(outputOption.makeOptionMandatory(true))
  .option('-n, --name <n>', 'Name of the generated client', 'Client')
  .option('-v, --verbose', 'Verbose output', false)
  .option('--formatter <formatter>', 'Formatter to use for the generated code')
  .action(async (options: PythonOptions) => {
    await runPython(options);
  });

export async function runPython(options: PythonOptions) {
  const spec = toIR({ spec: await loadSpec(options.spec) }, true);
  await generate(spec, {
    output: options.output,
    mode: options.mode || 'full',
    name: options.name,
    formatCode: ({ output }: { output: string }) => {
      if (options.formatter) {
        const [command, ...args] = options.formatter.split(' ');
        execFile(command, args, {
          env: { ...process.env, SDK_IT_OUTPUT: output },
        });
      } else {
        try {
          // Try black first (more common)
          execSync(`black ${shellEnv('SDK_IT_OUTPUT')}`, {
            env: { ...process.env, SDK_IT_OUTPUT: output },
            stdio: options.verbose ? 'inherit' : 'pipe',
          });
        } catch {
          try {
            // Fallback to ruff format if black is not available
            execSync(`ruff format ${shellEnv('SDK_IT_OUTPUT')}`, {
              env: { ...process.env, SDK_IT_OUTPUT: output },
              stdio: options.verbose ? 'inherit' : 'pipe',
            });
          } catch {
            // If neither formatter is available, continue without formatting
            if (options.verbose) {
              console.warn(
                'No Python formatter found (black or ruff). Skipping formatting.',
              );
            }
          }
        }
      }
    },
  });
}
