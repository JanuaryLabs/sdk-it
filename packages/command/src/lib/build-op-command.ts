import { Command, Option } from 'commander';
import { ZodError } from 'zod';

import type { Client } from '@sdk-it/rpc';
import type { IR, TunedOperationObject } from '@sdk-it/spec';
import { buildInput, operationSchema } from '@sdk-it/typescript';
import { schemaToZod } from '@sdk-it/rpc';

import { addFlagsFromSchema } from './flags.ts';
import { resolveInput } from './input.ts';
import { describeOperation } from './introspect.ts';
import {
  type OutputMode,
  writeError,
  writeOutput,
} from './output.ts';

interface BuildOpCommandArgs {
  ir: IR;
  operation: TunedOperationObject;
  method: string;
  path: string;
  client: Client;
}

export function buildOpCommand({
  ir,
  operation,
  method,
  path,
  client,
}: BuildOpCommandArgs): Command {
  const name = operation['x-fn-name'] ?? operation.operationId;
  const summary = operation.summary ?? operation.description ?? '';

  const cmd = new Command(name).description(summary);

  const details = buildInput(ir, operation);
  const inputJsonSchema = operationSchema(ir, operation, details.ct);
  const inputZodSchema = schemaToZod(inputJsonSchema, ir, { required: true });
  const flagMap = addFlagsFromSchema(cmd, inputJsonSchema, ir);

  cmd.addOption(
    new Option(
      '--input-file <path>',
      'Read input JSON from file (merged with flags and stdin)',
    ),
  );
  cmd.addOption(
    new Option(
      '--describe',
      'Print this operation\'s schema as JSON and exit',
    ),
  );

  if (flagMap.skipped.length) {
    const hints = flagMap.skipped
      .map((s) => `  --${s.name}: ${s.reason}`)
      .join('\n');
    cmd.addHelpText(
      'after',
      `\nFields supplied via --input-file or stdin only:\n${hints}`,
    );
  }

  const endpoint = `${method.toUpperCase()} ${path}`;

  cmd.action(async (_: unknown, thisCommand: Command) => {
    const opts = thisCommand.optsWithGlobals() as Record<string, unknown>;

    if (opts.describe) {
      const desc = describeOperation(ir, operation, method, path);
      process.stdout.write(JSON.stringify(desc, null, 2) + '\n');
      return;
    }

    const outputMode = (opts.output as OutputMode) ?? 'json';
    const inputFile = opts.inputFile as string | undefined;

    const flagValues: Record<string, unknown> = {};
    for (const n of flagMap.names) {
      if (opts[n] !== undefined) flagValues[n] = opts[n];
    }

    let input: unknown;
    try {
      input = await resolveInput({
        flags: flagValues,
        inputFile,
        schema: inputZodSchema,
        flagNames: flagMap.names,
      });
    } catch (err) {
      if (err instanceof ZodError) {
        writeError({ message: 'Invalid input', issues: err.issues });
      } else {
        writeError(err);
      }
      process.exitCode = 2;
      return;
    }

    try {
      const response = await client.request(endpoint, input as never);
      writeOutput(response, outputMode);
    } catch (err) {
      writeError(err);
      process.exitCode = 1;
    }
  });

  return cmd;
}
