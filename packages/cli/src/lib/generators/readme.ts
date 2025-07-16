import { Command } from 'commander';

import { toReadme } from '@sdk-it/readme';
import { type OurOpenAPIObject, augmentSpec, loadSpec } from '@sdk-it/spec';

import { outputOption, specOption } from '../options.ts';

export default new Command('readme')
  .description('Generate README')
  .addOption(specOption.makeOptionMandatory(true))
  .addOption(outputOption.makeOptionMandatory(true))
  .action(async (options: { spec: string; output: string }) => {
    await runReadme(options.spec, options.output);
  });

export async function runReadme(specFile: string, output: string) {
  const spec = augmentSpec({ spec: await loadSpec(specFile) });
  return toReadme(spec);
}
