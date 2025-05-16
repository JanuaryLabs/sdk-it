import type { HeadersInit, RequestConfig } from './request.ts';

export interface Interceptor {
  before?: (config: RequestConfig) => Promise<RequestConfig> | RequestConfig;
  after?: (response: Response) => Promise<Response> | Response;
}

export const createHeadersInterceptor = (
  defaultHeaders: () => Record<string, string | undefined>,
  requestHeaders: HeadersInit,
): Interceptor => {
  return {
    before({ init, url }) {
      // Priority Levels
      // 1. Headers Input
      // 2. Request Headers
      // 3. Default Headers
      const headers = defaultHeaders();

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

export const createBaseUrlInterceptor = (
  getBaseUrl: () => string,
): Interceptor => {
  return {
    before({ init, url }) {
      const baseUrl = getBaseUrl();
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

export const logInterceptor: Interceptor = {
  before({ url, init }) {
    console.log('Request:', { url, init });
    return { url, init };
  },
  after(response) {
    console.log('Response:', response);
    return response;
  },
};

/**
 * Creates an interceptor that logs detailed information about requests and responses.
 * @param options Configuration options for the logger
 * @returns An interceptor object with before and after handlers
 */
export const createDetailedLogInterceptor = (options?: {
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
  includeRequestBody?: boolean;
  includeResponseBody?: boolean;
}) => {
  const logLevel = options?.logLevel || 'info';
  const includeRequestBody = options?.includeRequestBody || false;
  const includeResponseBody = options?.includeResponseBody || false;

  return {
    async before(request: Request) {
      const logData = {
        url: request.url,
        method: request.method,
        contentType: request.headers.get('Content-Type'),
        headers: Object.fromEntries([...request.headers.entries()]),
      };

      console[logLevel]('🚀 Outgoing Request:', logData);

      if (includeRequestBody) {
        try {
          // Clone the request to avoid consuming the body stream
          const clonedRequest = request.clone();
          if (
            clonedRequest.headers
              .get('Content-Type')
              ?.includes('application/json')
          ) {
            const body = await clonedRequest.json().catch(() => null);
            console[logLevel]('Request Body:', body);
          } else {
            const body = await clonedRequest.text().catch(() => null);
            console[logLevel]('Request Body:', body);
          }
        } catch (error) {
          console.error('Could not log request body:', error);
        }
      }

      return request;
    },

    async after(response: Response) {
      const logData = {
        status: response.status,
        statusText: response.statusText,
        url: response.url,
        headers: Object.fromEntries([...response.headers.entries()]),
      };

      console[logLevel]('📥 Incoming Response:', logData);

      if (includeResponseBody && response.body) {
        try {
          // Clone the response to avoid consuming the body stream
          const clonedResponse = response.clone();
          if (
            clonedResponse.headers
              .get('Content-Type')
              ?.includes('application/json')
          ) {
            const body = await clonedResponse.json().catch(() => null);
            console[logLevel]('Response Body:', body);
          } else {
            const body = await clonedResponse.text().catch(() => null);
            if (body) {
              console[logLevel](
                'Response Body:',
                body.substring(0, 500) + (body.length > 500 ? '...' : ''),
              );
            } else {
              console[logLevel]('No response body');
            }
          }
        } catch (error) {
          console.error('Could not log response body:', error);
        }
      }

      return response;
    },
  };
};
