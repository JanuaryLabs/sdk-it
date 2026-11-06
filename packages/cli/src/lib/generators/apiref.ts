import { Command } from 'commander';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';

import { outputOption, specOption } from '../options.ts';

export default new Command('apiref')
  .description('Generate APIREF')
  .addOption(specOption.makeOptionMandatory(true))
  .addOption(outputOption.makeOptionMandatory(true))
  .action((options: { spec: string; output: string }) => {
    runApiRef(options.spec, options.output);
  });

export function runApiRef(spec: string, output: string) {
  execFileSync('nx', ['run', 'apiref:build', '--verbose'], {
    stdio: 'inherit',
    cwd: join(import.meta.dirname, '..', '..', 'apiref'),
    // The build runs in the apiref package, so a path the user typed is
    // anchored to the folder they ran the command in; a spec URL stays a URL.
    env: {
      ...process.env,
      VITE_SPEC: URL.canParse(spec) ? spec : resolve(spec),
      VITE_SDK_IT_OUTPUT: resolve(output),
    },
  });
}
