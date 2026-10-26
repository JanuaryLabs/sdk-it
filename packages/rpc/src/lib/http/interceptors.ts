import type { HeadersInit, RequestConfig } from './request.ts';

export interface Interceptor {
  before?: (config: RequestConfig) => Promise<RequestConfig> | RequestConfig;
  after?: (response: Response) => Promise<Response> | Response;
}

export const createHeadersInterceptor = (
  headers: Record<string, string | undefined>,
  requestHeaders: HeadersInit,
): Interceptor => {
  return {
    before({ init, url }) {
      // Priority Levels
      // 1. Headers Input
      // 2. Request Headers
      // 3. Default Headers

      for (const [key, value] of new Headers(requestHeaders)) {
        // Only set the header if it doesn't already exist and has a value
        // even though these headers are passed at operation level
        // still they are lower priority compared to the headers input
        if (value !== undefined && !init.headers.has(key)) {
          init.headers.set(key, value);
        }
      }

      for (const [key, value] of Object.entries(headers)) {
        // Only set the header if it doesn't already exist and has a value
        if (value !== undefined && !init.headers.has(key)) {
          init.headers.set(key, value);
        }
      }

      return { init, url };
    },
  };
};

export const createBaseUrlInterceptor = (baseUrl: string): Interceptor => {
  return {
    before({ init, url }) {
      if (url.protocol === 'local:') {
        return {
          init,
          url: new URL(url.href.replace('local://', baseUrl)),
        };
      }
      return { init, url };
    },
  };
};
