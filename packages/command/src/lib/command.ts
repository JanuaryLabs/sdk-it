import { Command, Option } from 'commander';
import type { OpenAPIObject } from 'openapi3-ts/oas31';

import { type ClientOptions, createRpc } from '@sdk-it/rpc';
import { forEachOperation, loadSpec, toIR } from '@sdk-it/spec';

import { buildOpCommand } from './build-op-command.ts';
import { describeAllOperations } from './introspect.ts';

export interface CommandOptions extends Partial<ClientOptions> {
  name: string;
  description?: string;
  version?: string;
  tokenEnv?: string;
  baseUrlEnv?: string;
}

function coerceSpec(
  spec: string | OpenAPIObject,
): Promise<OpenAPIObject> {
  if (typeof spec === 'string') return loadSpec(spec);
  return Promise.resolve(spec);
}

export async function command(
  spec: string | OpenAPIObject,
  options: CommandOptions,
): Promise<Command> {
  const raw = await coerceSpec(spec);
  const ir = toIR({ spec: raw, responses: { flattenErrorResponses: true } });

  const envPrefix = options.name.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase();
  const tokenEnv = options.tokenEnv ?? `${envPrefix}_TOKEN`;
  const baseUrlEnv = options.baseUrlEnv ?? `${envPrefix}_BASE_URL`;

  const envToken = process.env[tokenEnv];
  const envBaseUrl = process.env[baseUrlEnv];
  const resolvedBaseUrl =
    options.baseUrl ?? envBaseUrl ?? ir.servers?.[0]?.url;

  if (!resolvedBaseUrl) {
    throw new Error(
      `No base URL available. Pass options.baseUrl, set $${baseUrlEnv}, or add a servers entry to the OpenAPI spec.`,
    );
  }

  const client = createRpc(ir, {
    token: options.token ?? envToken,
    baseUrl: resolvedBaseUrl,
    fetch: options.fetch,
    headers: options.headers,
  });

  const program = new Command(options.name);
  if (options.description) program.description(options.description);
  if (options.version) program.version(options.version);

  program.addOption(
    new Option(
      '--token <token>',
      `API bearer token (or set $${tokenEnv})`,
    ),
  );
  program.addOption(
    new Option(
      '--base-url <url>',
      `API base URL (or set $${baseUrlEnv})`,
    ),
  );
  program.addOption(
    new Option('--output <mode>', 'Output format').choices([
      'json',
      'raw',
    ]).default('json'),
  );

  program.hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts() as Record<string, unknown>;
    const override: Partial<ClientOptions> = {};
    if (typeof opts.token === 'string') override.token = opts.token;
    if (typeof opts.baseUrl === 'string') override.baseUrl = opts.baseUrl;
    if (Object.keys(override).length) {
      client.setOptions(override);
    }
  });

  forEachOperation(ir, (entry, operation) => {
    program.addCommand(
      buildOpCommand({
        ir,
        operation,
        method: entry.method,
        path: entry.path,
        client,
      }),
    );
  });

  program.addCommand(
    new Command('schema')
      .description('Print all operation schemas as JSON')
      .action(() => {
        const all = describeAllOperations(ir);
        process.stdout.write(JSON.stringify(all, null, 2) + '\n');
      }),
  );

  return program;
}
