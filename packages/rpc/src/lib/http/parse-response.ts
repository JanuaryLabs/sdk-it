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

export async function buffered(response: Response) {
  // Statuses that, per the HTTP spec, carry no message body. These responses
  // usually omit Content-Type entirely, so this must run before the guard below.
  if (
    response.status === 204 ||
    response.status === 205 ||
    response.status === 304
  ) {
    return null;
  }

  const contentType = response.headers.get('Content-Type');
  if (!contentType) {
    throw new Error('Content-Type header is missing');
  }

  const { type } = parse(contentType);
  if (isBinaryContentType(type)) {
    return response.blob();
  }
  if (type.startsWith('text/')) {
    return response.text();
  }
  switch (type) {
    case 'application/json':
      return response.json();
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
