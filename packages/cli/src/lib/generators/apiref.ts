import { Command } from 'commander';
import { execa } from 'execa';
import { join, resolve } from 'node:path';

import { outputOption, specOption } from '../options.ts';

export default new Command('apiref')
  .description('Generate APIREF')
  .addOption(specOption.makeOptionMandatory(true))
  .addOption(outputOption.makeOptionMandatory(true))
  .action(async (options: { spec: string; output: string }) => {
    await runApiRef(options.spec, options.output);
  });

export function runApiRef(spec: string, output: string) {
  const packageDir = join(import.meta.dirname, '..', '..', 'apiref');
  return execa('nx', ['run', 'apiref:build', '--verbose'], {
    stdio: 'inherit',
    extendEnv: true,
    cwd: packageDir,
    // The build runs in the apiref package, so a path the user typed is
    // anchored to the folder they ran the command in; a spec URL stays a URL.
    env: {
      VITE_SPEC: URL.canParse(spec) ? spec : resolve(spec),
      VITE_SDK_IT_OUTPUT: resolve(output),
    },
  });
}
