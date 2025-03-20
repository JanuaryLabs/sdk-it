import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import type { OpenAPIObject } from 'openapi3-ts/oas31';
import { parse } from 'yaml';

export async function loadRemote(location: string) {
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
export async function loadLocal(location: string) {
  const extName = extname(location);
  switch (extName) {
    case '.json':
      return import(location, { with: { type: 'json' } }).then(
        (mod) => mod.default,
      );
    case '.yaml':
    case '.yml': {
      const text = await await readFile(location, 'utf-8');
      return parse(text);
    }
    default:
      throw new Error(`Unsupported file extension: ${extName}`);
  }
}

export function loadSpec(location: string): Promise<OpenAPIObject> {
  const [protocol] = location.split(':');
  if (protocol === 'http' || protocol === 'https') {
    return loadRemote(location);
  }
  return loadLocal(location);
}
