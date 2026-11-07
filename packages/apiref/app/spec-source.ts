interface SpecEnv {
  readonly VITE_SPEC?: string;
  readonly DEV: boolean;
}

/**
 * The location of the OpenAPI document that the API reference renders, from
 * `VITE_SPEC`. The route config calls this when React Router loads it, so a
 * build or a dev server without `VITE_SPEC` refuses to start.
 */
export function configuredSpec(env: SpecEnv): string {
  if (!env.VITE_SPEC) {
    throw new Error(
      'VITE_SPEC is not set. Set it to the path or URL of the OpenAPI document to render, for example VITE_SPEC=./openapi.json.',
    );
  }
  return env.VITE_SPEC;
}

/**
 * The spec location for one request: in dev, a `?spec=` parameter overrides
 * `VITE_SPEC`; a production build ignores it.
 */
export function requestSpec(url: URL, env: SpecEnv): string {
  return (env.DEV && url.searchParams.get('spec')) || configuredSpec(env);
}
