export type OutputMode = 'json' | 'raw';

function hasData(value: unknown): value is { data: unknown } {
  return typeof value === 'object' && value !== null && 'data' in value;
}

function stringifyJson(value: unknown): string {
  const pretty = process.stdout.isTTY;
  return pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value);
}

export function formatOutput(value: unknown, mode: OutputMode): string {
  const payload = hasData(value) ? value.data : value;

  if (payload === null || payload === undefined) return '';

  if (mode === 'raw') {
    if (typeof payload === 'string') return payload;
    return stringifyJson(payload);
  }

  return stringifyJson(payload);
}

export function writeOutput(value: unknown, mode: OutputMode): void {
  const formatted = formatOutput(value, mode);
  if (formatted.length === 0) return;
  process.stdout.write(formatted + '\n');
}

export function writeError(error: unknown): void {
  const payload: Record<string, unknown> = { error: true };
  if (error && typeof error === 'object') {
    if ('status' in error) payload.status = error.status;
    const hasData = 'data' in error;
    if (hasData) payload.data = error.data;
    if ('message' in error && !hasData) payload.message = error.message;
    if (Error.isError(error)) {
      payload.message = error.message;
      payload.name = error.name;
    }
  } else {
    payload.message = String(error);
  }
  process.stderr.write(JSON.stringify(payload, null, 2) + '\n');
}
