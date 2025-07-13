import { Command } from 'commander';
import { execa } from 'execa';
import { dirname, join } from 'node:path';
import { cwd } from 'node:process';

import { outputOption, specOption } from '../options.ts';

export default new Command('apiref')
  .description('Generate APIREF')
  .addOption(specOption.makeOptionMandatory(true))
  .addOption(outputOption.makeOptionMandatory(true))
  .action(async (options: { spec: string; output: string }) => {
    await runApiRef(options.spec, options.output);
  });

export function runApiRef(spec: string, output: string) {
  const packageDir = join(dirname(import.meta.url), '..', '..', 'apiref');
  console.log();
  return execa('nx', ['run', 'apiref:build', '--verbose'], {
    stdio: 'inherit',
    extendEnv: true,
    cwd: packageDir,
    env: {
      VITE_SPEC: spec,
      VITE_SDK_IT_OUTPUT: output,
    },
  });
}
