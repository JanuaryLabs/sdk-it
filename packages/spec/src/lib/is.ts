export function isStreamingContentType(
  contentType: string | null | undefined,
): boolean {
  return contentType === 'application/octet-stream';
}

export function isBinaryContentType(
  contentType: string | null | undefined,
): boolean {
  if (!contentType) {
    return false;
  }

  let mainType = contentType.trim();
  const semicolonIndex = mainType.indexOf(';');
  if (semicolonIndex !== -1) {
    mainType = mainType.substring(0, semicolonIndex).trim();
  }
  mainType = mainType.toLowerCase();

  if (mainType.startsWith('text/')) {
    return false;
  }
  if (mainType.endsWith('/json') || mainType.endsWith('+json')) {
    return false;
  }
  if (mainType.endsWith('/xml') || mainType.endsWith('+xml')) {
    return false;
  }
  if (mainType === 'application/xml' || mainType === 'text/xml') {
    return false;
  }
  if (
    mainType === 'application/x-www-form-urlencoded' ||
    mainType === 'multipart/form-data'
  ) {
    return false;
  }

  if (mainType.startsWith('image/')) {
    return true;
  }
  if (mainType.startsWith('audio/')) {
    return true;
  }
  if (mainType.startsWith('video/')) {
    return true;
  }
  if (mainType === 'application/pdf') {
    return true;
  }
  if (mainType === 'application/zip') {
    return true;
  }
  if (mainType === 'application/gzip') {
    return true;
  }
  if (mainType === 'application/x-7z-compressed') {
    return true;
  }
  if (mainType === 'application/x-tar') {
    return true;
  }
  if (
    mainType.startsWith('application/vnd.openxmlformats-officedocument.')
  ) {
    return true;
  }
  if (mainType.startsWith('application/vnd.ms-')) {
    return true;
  }
  if (mainType === 'application/msword') {
    return true;
  }

  return false;
}

export function isSuccessStatusCode(statusCode: number | string): boolean {
  if (typeof statusCode === 'string') {
    const statusGroup = +statusCode.slice(0, 1);
    const status = Number(statusCode);
    return (status >= 200 && status < 300) || (status >= 2 && statusGroup <= 3);
  }
  statusCode = Number(statusCode);
  return statusCode >= 200 && statusCode < 300;
}

export function isErrorStatusCode(statusCode: number | string): boolean {
  if (typeof statusCode === 'string') {
    const statusGroup = +statusCode.slice(0, 1);
    const status = Number(statusCode);
    return (
      status < 200 ||
      status >= 300 ||
      statusGroup >= 4 ||
      statusGroup === 0 ||
      statusGroup === 1
    );
  }
  statusCode = Number(statusCode);
  return statusCode < 200 || statusCode >= 300;
}

export function parseJsonContentType(contentType: string | null | undefined) {
  if (!contentType) {
    return null;
  }

  // 1. Trim whitespace
  let mainType = contentType.trim();

  // 2. Remove parameters (anything after the first ';')
  const semicolonIndex = mainType.indexOf(';');
  if (semicolonIndex !== -1) {
    mainType = mainType.substring(0, semicolonIndex).trim(); // Trim potential space before ';'
  }

  // 3. Convert to lowercase for case-insensitive comparison
  mainType = mainType.toLowerCase();

  if (mainType.endsWith('/json')) {
    return mainType.split('/')[1];
  } else if (mainType.endsWith('+json')) {
    return mainType.split('+')[1];
  }
  return null;
}

export function isTextContentType(
  contentType: string | null | undefined,
): boolean {
  if (!contentType) {
    return false; // Handle null, undefined, or empty string
  }

  // 1. Trim whitespace from the input string
  let mainType = contentType.trim();
  // 2. Find the position of the first semicolon (if any) to remove parameters
  const semicolonIndex = mainType.indexOf(';');
  if (semicolonIndex !== -1) {
    // Extract the part before the semicolon and trim potential space
    mainType = mainType.substring(0, semicolonIndex).trim();
  }
  // 3. Convert the main type part to lowercase for case-insensitive comparison
  mainType = mainType.toLowerCase();
  // 4. Compare against the standard text MIME types
  return mainType.startsWith('text/'); // Catch-all for other text/* types
}

/**
 * Checks if a given content type string represents Server-Sent Events (SSE).
 * Handles case-insensitivity, parameters (like charset), and leading/trailing whitespace.
 *
 * @param contentType The content type string to check (e.g., from a Content-Type header).
 * @returns True if the content type is 'text/event-stream', false otherwise.
 */
export function isSseContentType(
  contentType: string | null | undefined,
): boolean {
  if (!contentType) {
    return false; // Handle null, undefined, or empty string
  }

  // 1. Trim whitespace from the input string
  let mainType = contentType.trim();

  // 2. Find the position of the first semicolon (if any) to remove parameters
  const semicolonIndex = mainType.indexOf(';');
  if (semicolonIndex !== -1) {
    // Extract the part before the semicolon and trim potential space
    mainType = mainType.substring(0, semicolonIndex).trim();
  }

  // 3. Convert the main type part to lowercase for case-insensitive comparison
  mainType = mainType.toLowerCase();

  // 4. Compare against the standard SSE MIME type
  return mainType === 'text/event-stream';
}
