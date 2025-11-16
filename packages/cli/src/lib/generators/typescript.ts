import { Command, Option } from 'commander';
import { publish } from 'libnpmpublish';
import { execFile, execSync, spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { OpenAPIObject } from 'openapi3-ts/oas31';
import getAuthToken from 'registry-auth-token';

import { writeFiles } from '@sdk-it/core/file-system.js';
import { loadSpec } from '@sdk-it/spec';
import { generate } from '@sdk-it/typescript';

import {
  outputOption,
  parseDotConfig,
  parsePagination,
  specOption,
} from '../options.ts';
import type { TypeScriptOptions } from '../types.ts';

type Options = Omit<TypeScriptOptions, 'pagination'> & {
  output: string;
  pagination?: TypeScriptOptions['pagination'] | string;
};

export default new Command('typescript')
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
  .option('--no-default-formatter', 'Do not use the default formatter')
  .option('--no-install', 'Do not install dependencies')
  .option('-v, --verbose', 'Verbose output', false)
  .option(
    '--pagination <pagination>',
    'Configure pagination (e.g., "false", "true", "guess=false")',
    'true',
  )
  .addOption(
    new Option(
      '--publish <publish>',
      'Publish the SDK to a package registry (npm, github, or a custom registry)',
    )
      .hideHelp(true)
      .makeOptionMandatory(false),
  )
  .action(async (options: Options) => {
    await runTypescript(options);
  });

export async function runTypescript(options: Options) {
  if (!options.publish && !options.output) {
    throw new Error('Error: --publish or --output option is required.');
  }
  const spec = await loadSpec(options.spec);

  if (options.output) {
    await emitLocal(spec, {
      ...options,
      output: options.output,
    });
  }
  if (options.publish) {
    await emitRemote(spec, {
      ...options,
      publish: options.publish,
    });
  }
}

async function emitLocal(spec: OpenAPIObject, options: Options) {
  await generate(spec, {
    writer: writeFiles,
    output: options.output,
    mode: options.mode || 'minimal',
    name: options.name,
    pagination:
      typeof options.pagination === 'string'
        ? parsePagination(parseDotConfig(options.pagination ?? 'true'))
        : options.pagination,
    style: {
      name: 'github',
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
