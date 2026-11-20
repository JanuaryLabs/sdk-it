import { readFile } from 'node:fs/promises';

import { DocumentReadError } from './errors.js';

/** Reads the text of each document whose URL it can read. */
export interface DocumentSource {
  canRead(url: URL): boolean;
  read(url: URL): Promise<string>;
}

export class FileSource implements DocumentSource {
  canRead(url: URL) {
    return url.protocol === 'file:';
  }

  read(url: URL) {
    return readFile(url, 'utf-8');
  }
}

export class HttpSource implements DocumentSource {
  canRead(url: URL) {
    return url.protocol === 'http:' || url.protocol === 'https:';
  }

  async read(url: URL) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new DocumentReadError(
        url,
        `Failed to fetch ${url.href}: ${response.statusText}`,
      );
    }
    return response.text();
  }
}
