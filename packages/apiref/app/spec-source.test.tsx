import { describe, expect, test } from 'vitest';

import { loadSpec, toIR, toSidebar } from '@sdk-it/spec';

import { loader } from './root';
import { configuredSpec, requestSpec } from './spec-source';

const root = new URL('http://localhost/');
const withSpec = new URL('http://localhost/?spec=override.json');

describe('the spec source', () => {
  test('refuses to resolve when VITE_SPEC is unset', () => {
    expect(() => configuredSpec({ DEV: false })).toThrow(/VITE_SPEC/);
  });

  test('refuses a request when VITE_SPEC is unset', () => {
    expect(() => requestSpec(root, { DEV: true })).toThrow(/VITE_SPEC/);
  });

  test('is VITE_SPEC when set', () => {
    expect(configuredSpec({ VITE_SPEC: 'configured.json', DEV: false })).toBe(
      'configured.json',
    );
    expect(
      requestSpec(root, { VITE_SPEC: 'configured.json', DEV: false }),
    ).toBe('configured.json');
  });

  test('in dev, ?spec= overrides VITE_SPEC', () => {
    expect(
      requestSpec(withSpec, { VITE_SPEC: 'configured.json', DEV: true }),
    ).toBe('override.json');
  });

  test('in a production build, ?spec= is ignored', () => {
    expect(
      requestSpec(withSpec, { VITE_SPEC: 'configured.json', DEV: false }),
    ).toBe('configured.json');
  });

  test('the loader renders the spec the route config reads', async () => {
    const { spec, sidebar } = await loader({
      request: new Request(root),
      params: {},
    });

    const routeSpec = await toIR({
      spec: (await loadSpec(configuredSpec(import.meta.env))).spec,
    });
    expect(spec.info.title).toBe('SDK-IT CI fixture');
    expect(spec).toEqual(routeSpec);
    expect(sidebar).toEqual(toSidebar(routeSpec));
  });
});
