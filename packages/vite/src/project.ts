import type { Plugin } from 'vite';

export interface ProjectPluginOptions {
  config?: string;
}

export function projectPlugin(
  options: ProjectPluginOptions = {},
): Omit<Plugin, 'name'> {
  let root = process.cwd();

  const generate = async () => {
    const { generateProject, loadProjectConfig } = await import('@sdk-it/cli');
    const config = await loadProjectConfig({
      cwd: root,
      config: options.config,
    });
    await generateProject(config);
  };

  return {
    configResolved(config) {
      root = config.root;
    },
    async configureServer() {
      await generate();
    },
    async buildStart() {
      await generate();
    },
  };
}
