import { Command } from 'commander';
import { writeFile } from 'node:fs/promises';

import { toReadme } from '@sdk-it/readme';
import { loadSpec, toIR } from '@sdk-it/spec';

import { outputOption, specOption } from '../options.ts';

export default new Command('readme')
  .description('Generate README')
  .addOption(specOption.makeOptionMandatory(true))
  .addOption(outputOption.makeOptionMandatory(true))
  .action(async (options: { spec: string; output: string }) => {
    await runReadme(options.spec, options.output);
  });

export async function runReadme(specFile: string, output: string) {
  const spec = toIR({ spec: await loadSpec(specFile) });
  const content = toReadme(spec);
  await writeFile(output, content, 'utf-8');
}
