export type OutputMode = 'json' | 'raw';

function hasData(value: unknown): value is { data: unknown } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'data' in (value as Record<string, unknown>)
  );
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
    const err = error as Record<string, unknown>;
    if ('status' in err) payload.status = err.status;
    const hasData = 'data' in err;
    if (hasData) payload.data = err.data;
    if ('message' in err && !hasData) payload.message = err.message;
    if (err instanceof Error) {
      payload.message = err.message;
      payload.name = err.name;
    }
  } else {
    payload.message = String(error);
  }
  process.stderr.write(JSON.stringify(payload, null, 2) + '\n');
}
