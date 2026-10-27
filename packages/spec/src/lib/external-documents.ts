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

export function documentUrl(location: string, base: string | undefined) {
  if (!base && !URL.canParse(location)) {
    throw new Error(
      'the document declares no $self, so a relative URI has no base to resolve against',
    );
  }
  return new URL(location, base);
}

export function loadDocument(url: URL, documents: Documents) {
  let pending = documents.get(url.href);
  if (!pending) {
    pending = loadFile(
      url.protocol === 'file:' ? fileURLToPath(url) : url.href,
    );
    documents.set(url.href, pending);
  }
  return pending;
}

export function splitFragment(uri: string): [string, string | undefined] {
  const index = uri.indexOf('#');
  return index === -1
    ? [uri, undefined]
    : [uri.slice(0, index), uri.slice(index + 1)];
}

export function readPointer(document: unknown, fragment: string) {
  let current: unknown = document;
  for (const segment of fragment.split('/')) {
    if (!segment) {
      continue;
    }
    const key = decodeURIComponent(segment)
      .replaceAll('~1', '/')
      .replaceAll('~0', '~');
    if (
      current === null ||
      typeof current !== 'object' ||
      !(key in (current as object))
    ) {
      throw new Error(`no value at pointer #${fragment}`);
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
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
