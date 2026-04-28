import { type Command, InvalidArgumentError, Option } from 'commander';
import type { ReferenceObject, SchemaObject } from 'openapi3-ts/oas31';

import { followRef, isRef } from '@sdk-it/core';
import type { IR } from '@sdk-it/spec';

function resolve(
  ir: IR,
  schema: SchemaObject | ReferenceObject,
): SchemaObject {
  return isRef(schema) ? (followRef(ir, schema.$ref) as SchemaObject) : schema;
}

function isPrimitiveType(type: unknown): boolean {
  return (
    type === 'string' ||
    type === 'number' ||
    type === 'integer' ||
    type === 'boolean' ||
    type === 'null'
  );
}

function canBeFlag(ir: IR, schema: SchemaObject): boolean {
  if (schema.oneOf || schema.anyOf || schema.allOf) return false;
  if (schema.enum) return true;
  const type = schema.type;
  if (Array.isArray(type)) {
    return type.every((t) => isPrimitiveType(t));
  }
  if (isPrimitiveType(type)) return true;
  if (type === 'array' && schema.items) {
    const items = Array.isArray(schema.items)
      ? schema.items[0]
      : schema.items;
    if (!items) return false;
    const resolved = resolve(ir, items);
    const itemType = resolved.type;
    return (
      !resolved.oneOf &&
      !resolved.anyOf &&
      !resolved.allOf &&
      (isPrimitiveType(itemType) || !!resolved.enum)
    );
  }
  return false;
}

function coerceNumber(value: string, integer: boolean): number {
  const n = Number(value);
  if (Number.isNaN(n)) {
    throw new InvalidArgumentError(`"${value}" is not a valid number`);
  }
  return integer ? Math.trunc(n) : n;
}

function coerceBoolean(value: string): boolean {
  const lower = value.toLowerCase();
  if (lower === 'true' || lower === '1' || lower === 'yes' || lower === 'on') {
    return true;
  }
  if (
    lower === 'false' ||
    lower === '0' ||
    lower === 'no' ||
    lower === 'off'
  ) {
    return false;
  }
  throw new InvalidArgumentError(`"${value}" is not a valid boolean`);
}

function describe(schema: SchemaObject, required: boolean): string {
  const base = schema.description ?? '';
  const pieces: string[] = [];
  if (schema.type) pieces.push(String(schema.type));
  if (schema.format) pieces.push(`format: ${schema.format}`);
  if (required) pieces.push('required');
  if (schema.default !== undefined) {
    pieces.push(`default: ${JSON.stringify(schema.default)}`);
  }
  const tag = pieces.length ? ` (${pieces.join(', ')})` : '';
  return base + tag;
}

export interface FlagMap {
  names: Set<string>;
  skipped: Array<{ name: string; reason: string }>;
}

export function addFlagsFromSchema(
  command: Command,
  schema: SchemaObject,
  ir: IR,
): FlagMap {
  const names = new Set<string>();
  const skipped: FlagMap['skipped'] = [];
  const properties = schema.properties ?? {};
  const required = new Set(schema.required ?? []);

  for (const [name, propOrRef] of Object.entries(properties)) {
    const prop = resolve(ir, propOrRef as SchemaObject | ReferenceObject);
    if (!canBeFlag(ir, prop)) {
      skipped.push({
        name,
        reason: 'complex schema — supply via --input-file or stdin',
      });
      continue;
    }

    const isRequired = required.has(name);
    const desc = describe(prop, isRequired);

    if (prop.enum && Array.isArray(prop.enum)) {
      const opt = new Option(`--${name} <value>`, desc).choices(
        prop.enum.map((v) => String(v)),
      );
      command.addOption(opt);
      names.add(name);
      continue;
    }

    const primaryType = Array.isArray(prop.type) ? prop.type[0] : prop.type;

    if (primaryType === 'boolean') {
      command.addOption(new Option(`--${name}`, desc));
      command.addOption(new Option(`--no-${name}`, `Disable --${name}`));
      names.add(name);
      continue;
    }

    if (primaryType === 'array') {
      const items = Array.isArray(prop.items) ? prop.items[0] : prop.items;
      const itemSchema = items
        ? resolve(ir, items as SchemaObject | ReferenceObject)
        : ({} as SchemaObject);
      const itemType = Array.isArray(itemSchema.type)
        ? itemSchema.type[0]
        : itemSchema.type;
      const opt = new Option(
        `--${name} <value>`,
        `${desc} (repeatable)`,
      ).argParser((value, previous: unknown[] | undefined) => {
        const acc = previous ?? [];
        if (itemType === 'number' || itemType === 'integer') {
          return [...acc, coerceNumber(value, itemType === 'integer')];
        }
        if (itemType === 'boolean') {
          return [...acc, coerceBoolean(value)];
        }
        return [...acc, value];
      });
      command.addOption(opt);
      names.add(name);
      continue;
    }

    if (primaryType === 'number' || primaryType === 'integer') {
      const opt = new Option(`--${name} <value>`, desc).argParser((v) =>
        coerceNumber(v, primaryType === 'integer'),
      );
      command.addOption(opt);
      names.add(name);
      continue;
    }

    command.addOption(new Option(`--${name} <value>`, desc));
    names.add(name);
  }

  return { names, skipped };
}
