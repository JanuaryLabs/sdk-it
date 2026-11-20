import type { Plugin } from 'vite';

export interface ProjectSdkOptions {
  /** The project config file; the CLI finds it from the Vite root without one. */
  config?: string;
}

/** Generates every client of an sdk-it project, as `sdk-it generate` does. */
export class ProjectSdk {
  readonly #options: ProjectSdkOptions;
  #root = process.cwd();

  constructor(options: ProjectSdkOptions) {
    this.#options = options;
  }

  toPlugin(): Plugin {
    const configure = (root: string) => {
      this.#root = root;
    };
    const generate = () => this.#generate();
    return {
      name: 'sdk-it',
      configResolved(config) {
        configure(config.root);
      },
      async configureServer() {
        await generate();
      },
      async buildStart() {
        await generate();
      },
    };
  }

  async #generate() {
    const { generateProject, loadProjectConfig } = await import('@sdk-it/cli');
    const config = await loadProjectConfig({
      cwd: this.#root,
      config: this.#options.config,
    });
    await generateProject(config);
  }
}
