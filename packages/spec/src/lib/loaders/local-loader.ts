import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { parse } from 'yaml';

export async function loadLocal(location: string) {
  const extName = extname(location);
  const text = await readFile(location, 'utf-8');
  switch (extName) {
    case '.json':
      return JSON.parse(text);
    case '.yaml':
    case '.yml':
      return parse(text);
    default:
      throw new Error(`Unsupported file extension: ${extName}`);
  }
}
