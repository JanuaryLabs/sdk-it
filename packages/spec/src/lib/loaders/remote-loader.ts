import { extname } from 'node:path';
import type { OpenAPIObject } from 'openapi3-ts/oas31';
import { parse } from 'yaml';

export async function loadRemote(location: string): Promise<OpenAPIObject> {
  const extName = extname(location);
  const response = await fetch(location);
  switch (extName) {
    case '.json':
      return response.json() as Promise<OpenAPIObject>;
    case '.yaml':
    case '.yml': {
      const text = await response.text();
      return parse(text);
    }
    default:
      try {
        // try to parse it as json first
        return response.json() as Promise<OpenAPIObject>;
      } catch {
        // parse as yaml
        const text = await response.text();
        return parse(text) as Promise<OpenAPIObject>;
      }
  }
}
