import { extname } from 'node:path';
import { parse } from 'yaml';

export async function loadRemote<T>(location: string): Promise<T> {
  const extName = extname(location);
  const response = await fetch(location);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${location}: ${response.statusText}`);
  }
  switch (extName) {
    case '.json':
      return response.json();
    case '.yaml':
    case '.yml': {
      const text = await response.text();
      return parse(text);
    }
    default: {
      const text = await response.text();
      try {
        // try to parse it as json first
        return JSON.parse(text);
      } catch {
        // parse as yaml
        return parse(text);
      }
    }
  }
}
