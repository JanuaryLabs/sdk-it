import { Command } from 'commander';
import { execa } from 'execa';

import { outputOption, specOption } from './options.ts';

export default new Command('apiref')
  .description('Generate APIREF')
  .addOption(specOption.makeOptionMandatory(true))
  .addOption(outputOption.makeOptionMandatory(true))
  .action(async (options: { spec: string; output: string }) => {
    await execa('nx', ['run', 'apiref:build'], {
      stdio: 'inherit',
      extendEnv: true,
      env: {
        VITE_SPEC: options.spec,
        VITE_SDK_IT_OUTPUT: options.output,
      },
    });
  });
