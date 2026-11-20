import { fileURLToPath } from 'node:url';

import { loadLocal } from './loaders/local-loader.js';
import { loadRemote } from './loaders/remote-loader.js';

export type Documents = Map<string, Promise<unknown>>;

export function loadFile<T>(location: string): Promise<T> {
  if (isRemote(location)) {
    return loadRemote(location);
  }
  return loadLocal(location);
}

export function isRemote(location: string) {
  const [protocol] = location.split(':');
  return protocol === 'http' || protocol === 'https';
}

export function loadDocument(url: URL, documents: Documents) {
  return documents.getOrInsertComputed(url.href, () =>
    loadFile(url.protocol === 'file:' ? fileURLToPath(url) : url.href),
  );
}

export function availableName(
  taken: Record<string, unknown>,
  candidate: string,
) {
  let name = candidate;
  let suffix = 2;
  while (taken[name]) {
    name = `${candidate}${suffix++}`;
  }
  return name;
}
