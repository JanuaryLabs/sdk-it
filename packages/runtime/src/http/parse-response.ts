import { parse } from 'fast-content-type-parse';

function isBinaryContentType(contentType: string) {
  const type = contentType.toLowerCase();
  if (type.startsWith('image/')) {
    return true;
  }
  if (type.startsWith('audio/')) {
    return true;
  }
  if (type.startsWith('video/')) {
    return true;
  }
  switch (type) {
    case 'application/pdf':
    case 'application/zip':
    case 'application/gzip':
    case 'application/x-7z-compressed':
    case 'application/x-tar':
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    case 'application/vnd.openxmlformats-officedocument.presentationml.presentation':
    case 'application/vnd.ms-excel':
    case 'application/vnd.ms-powerpoint':
    case 'application/msword':
    case 'application/octet-stream':
      return true;
    default:
      return false;
  }
}

export function chunked(response: Response) {
  return response.body!;
}

// The operation declares no body; release the unread stream so the
// connection is not held until garbage collection.
export async function bodyless(response: Response) {
  await response.body?.cancel();
  return null;
}

/** The body kinds the buffered parser reads: what the spec declares for a status. */
export type BufferedBody = 'json' | 'text' | 'binary';

/**
 * Reads a body by its Content-Type. A response without one reads as the body
 * the spec declares for its status, or, with none declared, as the
 * application/octet-stream that RFC 9110 §8.3 lets a recipient assume.
 */
export function buffered(declared?: BufferedBody) {
  return async (response: Response): Promise<unknown> => {
    // Statuses that, per the HTTP spec, carry no message body. These
    // responses usually omit Content-Type entirely.
    if (
      response.status === 204 ||
      response.status === 205 ||
      response.status === 304
    ) {
      return null;
    }
    const contentType = response.headers.get('Content-Type');
    if (contentType) {
      return byContentType(response, contentType);
    }
    const bytes = await response.bytes();
    if (bytes.byteLength === 0) {
      return null;
    }
    switch (declared) {
      case 'json':
        return JSON.parse(new TextDecoder().decode(bytes));
      case 'text':
        return new TextDecoder().decode(bytes);
      default:
        return new Blob([bytes], { type: 'application/octet-stream' });
    }
  };
}

async function byContentType(response: Response, contentType: string) {
  const { type } = parse(contentType);
  if (isBinaryContentType(type)) {
    return response.blob();
  }
  if (type.startsWith('text/')) {
    return response.text();
  }
  if (type === 'application/json' || type.endsWith('+json')) {
    return response.json();
  }
  switch (type) {
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
