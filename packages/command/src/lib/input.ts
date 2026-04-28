import { readFile } from 'node:fs/promises';
import type { ZodSchema } from 'zod';

async function readStdinIfPiped(): Promise<unknown> {
  if (process.stdin.isTTY) return undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) return undefined;
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Failed to parse JSON from stdin: ${(err as Error).message}`,
    );
  }
}

async function readJsonFile(path: string): Promise<unknown> {
  try {
    const raw = await readFile(path, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Failed to read JSON from ${path}: ${(err as Error).message}`,
    );
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' && value !== null && !Array.isArray(value)
  );
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
  schema: ZodSchema;
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
