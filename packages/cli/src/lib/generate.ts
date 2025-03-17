import { Command, Option } from 'commander';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { parse } from 'yaml';

import { generate } from '@sdk-it/typescript';

interface Options {
  spec: string;
  output: string;
  language: string;
  mode?: 'full' | 'minimal';
  name?: string;
  useTsExtension: boolean;
  /**
   * Command to run the formatter.
   * @example 'biome check $SDK_IT_OUTPUT --write'
   * @example 'prettier $SDK_IT_OUTPUT --write'
   */
  formatter?: string;
  framework?: string;
}

const specOption = new Option(
  '-s, --spec <spec>',
  'Path to OpenAPI specification file',
);

const outputOption = new Option(
  '-o, --output <output>',
  'Output directory for the generated SDK',
);

async function loadRemote(location: string) {
  const extName = extname(location);
  const response = await fetch(location);
  switch (extName) {
    case '.json':
      return response.json();
    case '.yaml':
    case '.yml': {
      const text = await response.text();
      return parse(text);
    }
    default:
      try {
        // try to parse it as json first
        return response.json();
      } catch {
        // parse as yaml
        const text = await response.text();
        return parse(text);
      }
  }
}

async function loadLocal(location: string) {
  const extName = extname(location);
  switch (extName) {
    case '.json':
      return import(location);
    case '.yaml':
    case '.yml': {
      const text = await await readFile(location, 'utf-8');
      return parse(text);
    }
    default:
      throw new Error(`Unsupported file extension: ${extName}`);
  }
}

function loadSpec(location: string) {
  const [protocol] = location.split(':');
  if (protocol === 'http' || protocol === 'https') {
    return loadRemote(location);
  }
  return loadLocal(location);
}

export default new Command('generate')
  .description(`Generate SDK out of a openapi spec file.`)
  .addOption(specOption.makeOptionMandatory(true))
  .addOption(outputOption.makeOptionMandatory(true))
  .option(
    '--useTsExtension [value]',
    'Use .ts extension for generated files',
    (value) => (value === 'false' ? false : true),
    true,
  )
  .option('-l, --language <language>', 'Programming language for the SDK')
  .option(
    '-m, --mode <mode>',
    'full: generate a full project including package.json and tsconfig.json. useful for monorepo/workspaces minimal: generate only the client sdk',
  )
  .option('-n, --name <name>', 'Name of the generated client', 'Client')
  .option(
    '-f, --framework <framework>',
    'Framework that is integrating with the SDK',
  )
  .option('--formatter <formatter>', 'Formatter to use for the generated code')
  .action(async (options: Options) => {
    const spec = await loadSpec(options.spec);
    await generate(spec, {
      output: options.output,
      mode: options.mode || 'minimal',
      name: options.name,
      useTsExtension: options.useTsExtension,
      formatCode: ({ env, output }) => {
        if (options.formatter) {
          const [command, ...args] = options.formatter.split(' ');
          execFile(command, args, { env: { ...env, SDK_IT_OUTPUT: output } });
        }
      },
    });
  });
