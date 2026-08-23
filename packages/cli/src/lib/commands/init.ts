import { Command } from 'commander';

import { initializeProject } from '../project.ts';

export default new Command('init')
  .description('Initialize SDK-IT from a backend TypeScript project')
  .requiredOption('--project <tsconfig>', 'Backend tsconfig path')
  .action(async ({ project }: { project: string }) => {
    await initializeProject({ tsconfig: project });
    console.log('SDK-IT project configuration initialized.');
  });
