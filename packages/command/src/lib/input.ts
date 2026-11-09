import { readFile } from 'node:fs/promises';
import { text } from 'node:stream/consumers';
import type { ZodType } from 'zod';

async function readStdinIfPiped(): Promise<unknown> {
  if (process.stdin.isTTY) return undefined;
  const raw = (await text(process.stdin)).trim();
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Failed to parse JSON from stdin: ${Error.isError(err) ? err.message : String(err)}`,
      { cause: err },
    );
  }
}

async function readJsonFile(path: string): Promise<unknown> {
  try {
    const raw = await readFile(path, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Failed to read JSON from ${path}: ${Error.isError(err) ? err.message : String(err)}`,
      { cause: err },
    );
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mergeSources(
  file: unknown,
  stdin: unknown,
  flags: Record<string, unknown>,
): Record<string, unknown> {
  const fileObj = isPlainObject(file) ? file : {};
  const stdinObj = isPlainObject(stdin) ? stdin : {};
  return { ...fileObj, ...stdinObj, ...flags };
}

export interface ResolveInputOptions {
  flags: Record<string, unknown>;
  inputFile?: string;
  schema: ZodType;
  flagNames: Set<string>;
}

export async function resolveInput({
  flags,
  inputFile,
  schema,
  flagNames,
}: ResolveInputOptions): Promise<unknown> {
  const onlySchemaFlags: Record<string, unknown> = {};
  for (const name of flagNames) {
    if (flags[name] !== undefined) {
      onlySchemaFlags[name] = flags[name];
    }
  }

  const file = inputFile ? await readJsonFile(inputFile) : undefined;
  const stdin = await readStdinIfPiped();
  const merged = mergeSources(file, stdin, onlySchemaFlags);

  const parsed = await schema.parseAsync(merged);
  return parsed;
}
