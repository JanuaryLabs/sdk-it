import { Command } from 'commander';
import { execa } from 'execa';

import { outputOption, specOption } from '../options.ts';

export default new Command('readme')
  .description('Generate README')
  .addOption(specOption.makeOptionMandatory(true))
  .addOption(outputOption.makeOptionMandatory(true))
  .action(async (options: { spec: string; output: string }) => {
    await runReadme(options.spec, options.output);
  });

export function runReadme(spec: string, output: string) {
  return execa('nx', ['run', 'readme:build'], {
    stdio: 'inherit',
    extendEnv: true,
    env: {
      VITE_SPEC: spec,
      VITE_SDK_IT_OUTPUT: output,
    },
  });
}
