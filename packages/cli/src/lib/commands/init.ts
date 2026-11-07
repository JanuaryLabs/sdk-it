import { Command } from 'commander';

import { initializeProject } from '../project.ts';

export default new Command('init')
  .description('Initialize SDK-IT from a backend TypeScript project')
  .requiredOption('-n, --name <name>', 'Name of the generated client')
  .requiredOption('--project <tsconfig>', 'Backend tsconfig path')
  .action(async ({ name, project }: { name: string; project: string }) => {
    await initializeProject({ name, tsconfig: project });
    console.log('SDK-IT project configuration initialized.');
  });
