export interface Interceptor {
  before?: (request: Request) => Promise<Request> | Request;
  after?: (response: Response) => Promise<Response> | Response;
}

export const createDefaultHeadersInterceptor = (
  getHeaders: () => Record<string, string | undefined>,
) => {
  return {
    before(request: Request) {
      const headers = getHeaders();

      for (const [key, value] of Object.entries(headers)) {
        // Only set the header if it doesn't already exist and has a value
        if (value !== undefined && !request.headers.has(key)) {
          request.headers.set(key, value);
        }
      }

      return request;
    },
  };
};

export const createBaseUrlInterceptor = (getBaseUrl: () => string) => {
  return {
    before(request: Request) {
      const baseUrl = getBaseUrl();
      if (request.url.startsWith('local://')) {
        return new Request(request.url.replace('local://', baseUrl), request);
      }
      return request;
    },
  };
};

export const logInterceptor = {
  before(request: Request) {
    console.log('Request', request);
    return request;
  },
  after(response: Response) {
    console.log('Response', response);
    return response;
  },
};
