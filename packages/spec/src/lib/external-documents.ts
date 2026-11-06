import { fileURLToPath } from 'node:url';

import { pointerTokens, valueAtPointer } from '@sdk-it/core';

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
  return documents.getOrInsertComputed(url.href, () =>
    loadFile(url.protocol === 'file:' ? fileURLToPath(url) : url.href),
  );
}

export function splitFragment(uri: string): [string, string | undefined] {
  const index = uri.indexOf('#');
  return index === -1
    ? [uri, undefined]
    : [uri.slice(0, index), uri.slice(index + 1)];
}

export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function readPointer(document: unknown, fragment: string) {
  const value = valueAtPointer(document, pointerTokens(fragment));
  if (value === undefined) {
    throw new Error(`no value at pointer #${fragment}`);
  }
  return value;
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
