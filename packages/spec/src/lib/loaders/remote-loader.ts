import { extname } from 'node:path';
import { parse } from 'yaml';

export async function loadRemote<T>(location: string): Promise<T> {
  const extName = extname(location);
  const response = await fetch(location);
  switch (extName) {
    case '.json':
      return response.json() as Promise<T>;
    case '.yaml':
    case '.yml': {
      const text = await response.text();
      return parse(text);
    }
    default:
      try {
        // try to parse it as json first
        return response.json() as Promise<T>;
      } catch {
        // parse as yaml
        const text = await response.text();
        return parse(text) as Promise<T>;
      }
  }
}
