import { extname } from 'node:path';
import { parse } from 'yaml';

/** Turns the text of a document into its value, for the URLs whose extension it knows. */
export interface DocumentParser {
  canParse(url: URL): boolean;
  parse(text: string): unknown;
}

export class JsonParser implements DocumentParser {
  canParse(url: URL) {
    return extname(url.pathname) === '.json';
  }

  parse(text: string): unknown {
    return JSON.parse(text);
  }
}

export class YamlParser implements DocumentParser {
  canParse(url: URL) {
    const extension = extname(url.pathname);
    return extension === '.yaml' || extension === '.yml';
  }

  parse(text: string): unknown {
    return parse(text);
  }
}
