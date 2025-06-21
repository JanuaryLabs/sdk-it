import { Command, Option } from 'commander';
import { publish } from 'libnpmpublish';
import { execFile, execSync, spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { OpenAPIObject } from 'openapi3-ts/oas31';
import getAuthToken from 'registry-auth-token';

import { writeFiles } from '@sdk-it/core/file-system.js';
import { augmentSpec, loadSpec } from '@sdk-it/spec';
import { generate } from '@sdk-it/typescript';

import { outputOption, specOption } from '../options.ts';

interface Options {
  spec: string;
  output?: string;
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
  install: boolean;
  verbose: boolean;
  defaultFormatter: boolean;
  outputType?: 'default' | 'status';
  errorAsValue?: boolean;
  readme?: boolean;
  publish?: string;
}

const command = new Command('typescript')
  .alias('ts')
  .description('Generate TypeScript SDK')
  .addOption(specOption.makeOptionMandatory(true))
  .addOption(outputOption.makeOptionMandatory(false))
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
  .option(
    '--install',
    'Install dependencies using npm (only in full mode)',
    true,
  )
  .option(
    '--readme <readme>',
    'Generate a README file',
    (value) => (value === 'false' ? false : true),
    true,
  )
  .option('--output-type <outputType>', 'Endpoint output type', 'default')
  .option(
    '--error-as-value <errorAsValue>',
    'Treat errors as values instead of throwing them',
    (value) => (value === 'false' ? false : true),
    false,
  )
  .option('--no-default-formatter', 'Do not use the default formatter')
  .option('--no-install', 'Do not install dependencies')
  .option('-v, --verbose', 'Verbose output', false)
  .addOption(
    new Option(
      '--publish <publish>',
      'Publish the SDK to a package registry (npm, github, or a custom registry)',
    )
      .hideHelp(true)
      .makeOptionMandatory(false),
  )
  .action(async (options: Options) => {
    if (!options.publish && !options.output) {
      command.error('Error: --publish or --output option is required.', {
        exitCode: 1,
      });
      return;
    }
    const spec = augmentSpec(
      {
        spec: await loadSpec(options.spec),
        responses: { flattenErrorResponses: true },
      },
      false,
    );
    if (options.output) {
      await emitLocal(spec, { ...options, output: options.output });
    }
    if (options.publish) {
      await emitRemote(spec, {
        ...options,
        publish: options.publish,
      });
    }
  });

async function emitLocal(
  spec: OpenAPIObject,
  options: Options & { output: string },
) {
  await generate(spec, {
    writer: writeFiles,
    output: options.output,
    mode: options.mode || 'minimal',
    name: options.name,
    style: {
      name: 'github',
      outputType: options.outputType,
      errorAsValue: options.errorAsValue,
    },
    readme: options.readme,
    useTsExtension: options.useTsExtension,
    formatCode: ({ env, output }) => {
      if (options.formatter) {
        const [command, ...args] = options.formatter.split(' ');
        execFile(command, args, {
          env: { ...env, SDK_IT_OUTPUT: output },
        });
      } else if (options.defaultFormatter) {
        spawnSync('npx', ['-y', 'prettier', output, '--write'], {
          env: {
            ...env,
            SDK_IT_OUTPUT: output,
            NODE_OPTIONS: '--experimental-strip-types',
          },
          stdio: options.verbose ? 'inherit' : 'pipe',
        });
      }
    },
  });

  // Install dependencies if in full mode and install option is enabled
  if (options.install && options.mode === 'full') {
    console.log('Installing dependencies...');
    execSync('npm install', {
      cwd: options.output,
      stdio: options.verbose ? 'inherit' : 'pipe',
    });
  }
}

async function emitRemote(
  spec: OpenAPIObject,
  options: Options & { publish: string },
) {
  const registry =
    options.publish === 'npm'
      ? 'https://registry.npmjs.org/'
      : options.publish === 'github'
        ? 'https://npm.pkg.github.com/'
        : options.publish;

  console.log('Publishing to registry:', registry);
  const path = join(tmpdir(), crypto.randomUUID());
  await emitLocal(spec, {
    ...options,
    output: path,
    install: false,
    mode: 'full',
  });
  const manifest = JSON.parse(
    await readFile(join(path, 'package.json'), 'utf-8'),
  );
  const registryUrl = new URL(registry);
  const npmrc = process.env.NPM_TOKEN
    ? {
        npmrc: {
          registry,
          [`//${registryUrl.hostname}:_authToken`]: process.env.NPM_TOKEN,
        },
      }
    : registry;
  const auth = getAuthToken(npmrc);
  if (!auth || !auth.token) {
    throw new Error(
      'No npm auth token found in .npmrc or environment. please provide NPM_TOKEN.',
    );
  }
  const packResult = execSync('npm pack --pack-destination .', { cwd: path });
  const [tgzName] = packResult.toString().trim().split('\n');
  await publish(manifest, await readFile(join(path, tgzName)), {
    registry,
    defaultTag: 'latest',
    forceAuth: {
      token: auth.token,
    },
    strictSSL: true,
    preferOnline: true,
  });
}

export default command;
