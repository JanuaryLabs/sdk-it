import { parse } from 'fast-content-type-parse';

export async function handleError(response: Response) {
  try {
    if (response.status >= 400 && response.status < 500) {
      const body = (await response.json()) as Record<string, any>;
      return {
        status: response.status,
        body: body,
      };
    }
    return new Error(
      `An error occurred while fetching the data. Status: ${response.status}`,
    );
  } catch (error) {
    return error as any;
  }
}

async function handleChunkedResponse(response: Response, contentType: string) {
  const { type } = parse(contentType);

  switch (type) {
    case 'application/json': {
      let buffer = '';
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value);
      }
      return JSON.parse(buffer);
    }
    case 'text/html':
    case 'text/plain': {
      let buffer = '';
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value);
      }
      return buffer;
    }
    default:
      return response.body;
  }
}

export async function parseResponse(response: Response) {
  const contentType = response.headers.get('Content-Type');
  if (!contentType) {
    throw new Error('Content-Type header is missing');
  }

  if (response.status === 204) {
    return null;
  }
  const isChunked = response.headers.get('Transfer-Encoding') === 'chunked';
  if (isChunked) {
    return response.body!;
    // return handleChunkedResponse(response, contentType);
  }

  const { type } = parse(contentType);
  switch (type) {
    case 'application/json':
      return response.json();
    case 'text/plain':
      return response.text();
    case 'text/html':
      return response.text();
    case 'text/xml':
    case 'application/xml':
      return response.text();
    case 'application/x-www-form-urlencoded': {
      const text = await response.text();
      return Object.fromEntries(new URLSearchParams(text));
    }
    case 'multipart/form-data':
      return response.formData();
    default:
      throw new Error(`Unsupported content type: ${contentType}`);
  }
}
