import type { Context } from 'hono';
import { getContext } from 'hono/context-storage';
import type {
  ContentfulStatusCode,
  RedirectStatusCode,
} from 'hono/utils/http-status';

type Data = any;
function send(
  context: Context,
  value: Data | undefined | null,
  status: ContentfulStatusCode,
  headers?: Readonly<Record<string, string>>,
) {
  if (value === undefined || value === null) {
    return context.body(null, status, headers);
  }
  const responseHeaders = { ...headers };
  responseHeaders['Content-Type'] ??= 'application/json';
  if (responseHeaders['Content-Type'].includes('application/json')) {
    return context.body(JSON.stringify(value), status, responseHeaders);
  }
  return context.body(value, status, responseHeaders);
}

export function createOutput(contextFn: () => Context) {
  return {
    nocontent() {
      const context = contextFn();
      return context.body(null, 204, {});
    },
    ok(value: Data | undefined | null, headers?: Record<string, string>) {
      return send(contextFn(), value, 200, headers);
    },
    created(
      valueOrUri: string | Data,
      value: Data | undefined | null,
      headers?: Record<string, string>,
    ) {
      if (typeof valueOrUri === 'string') {
        // If no content is provided, we send null
        return send(contextFn(), value, 201, {
          Location: valueOrUri,
          ...(headers || {}),
        });
      } else {
        // valueOrUri is the data
        return send(contextFn(), valueOrUri, 201, headers);
      }
    },
    redirect(uri: string | URL, statusCode?: unknown) {
      const context = contextFn();
      return context.redirect(
        uri.toString(),
        (statusCode as RedirectStatusCode) ?? undefined,
      );
    },
    attachment(buffer: Buffer, filename: string, mimeType: string) {
      const context = contextFn();
      // https://github.com/honojs/hono/issues/3720
      return context.body(buffer as never, 200, {
        'Content-Type': mimeType,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': buffer.length.toString(),
      });
    },
    badRequest(
      value: Data | undefined | null,
      headers?: Record<string, string>,
    ) {
      return send(contextFn(), value, 400, headers);
    },
    unauthorized(
      value: Data | undefined | null,
      headers?: Record<string, string>,
    ) {
      return send(contextFn(), value, 401, headers);
    },
    forbidden(
      value: Data | undefined | null,
      headers?: Record<string, string>,
    ) {
      return send(contextFn(), value, 403, headers);
    },
    notFound(value: Data | undefined | null, headers?: Record<string, string>) {
      return send(contextFn(), value, 404, headers);
    },
    notImplemented(
      value: Data | undefined | null,
      headers?: Record<string, string>,
    ) {
      return send(contextFn(), value, 501, headers);
    },
    accepted(value: Data | undefined | null, headers?: Record<string, string>) {
      return send(contextFn(), value, 202, headers);
    },
    conflict(value: Data | undefined | null, headers?: Record<string, string>) {
      return send(contextFn(), value, 409, headers);
    },
    unprocessableEntity(
      value: Data | undefined | null,
      headers?: Record<string, string>,
    ) {
      return send(contextFn(), value, 422, headers);
    },
    internalServerError(
      value: Data | undefined | null,
      headers?: Record<string, string>,
    ) {
      return send(contextFn(), value, 500, headers);
    },
    serviceUnavailable(
      value: Data | undefined | null,
      headers?: Record<string, string>,
    ) {
      return send(contextFn(), value, 503, headers);
    },
  };
}

export const output = createOutput(() => getContext());
