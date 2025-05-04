import { parse as parseContentType } from 'fast-content-type-parse';
import type { MiddlewareHandler, ValidationTargets } from 'hono';
import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import z from 'zod';

type ContentType =
  | 'application/json'
  | 'application/x-www-form-urlencoded'
  | 'multipart/form-data'
  | 'text/plain';

type ValidatorConfig = Record<
  string,
  { select: unknown; against: z.ZodTypeAny }
>;

type ExtractInput<T extends ValidatorConfig> = {
  [K in keyof T]: z.infer<T[K]['against']>;
};

type HasUndefined<T> = undefined extends T ? true : false;

type InferTarget<
  T extends ValidatorConfig,
  S,
  Target extends keyof ValidationTargets,
> = {
  [K in keyof T as T[K]['select'] extends S ? K : never]: HasUndefined<
    z.infer<T[K]['against']>
  > extends true
    ? z.infer<T[K]['against']> | undefined
    : z.infer<T[K]['against']> extends ValidationTargets[Target]
      ? z.infer<T[K]['against']>
      : z.infer<T[K]['against']>;
};

type InferIn<T extends ValidatorConfig> = (keyof InferTarget<
  T,
  QuerySelect | QueriesSelect,
  'query'
> extends never
  ? never
  : { query: InferTarget<T, QuerySelect | QueriesSelect, 'query'> }) &
  (keyof InferTarget<T, BodySelect, 'json'> extends never
    ? never
    : { json: InferTarget<T, BodySelect, 'json'> }) &
  (keyof InferTarget<T, ParamsSelect, 'param'> extends never
    ? never
    : { param: InferTarget<T, ParamsSelect, 'param'> }) &
  (keyof InferTarget<T, HeadersSelect, 'header'> extends never
    ? never
    : { header: InferTarget<T, HeadersSelect, 'header'> }) &
  (keyof InferTarget<T, CookieSelect, 'cookie'> extends never
    ? never
    : { cookie: InferTarget<T, CookieSelect, 'cookie'> });

// Marker classes
class BodySelect {
  #private = 0;
}
class QuerySelect {
  #private = 0;
}
class QueriesSelect {
  #private = 0;
}
class ParamsSelect {
  #private = 0;
}
class HeadersSelect {
  #private = 0;
}
class CookieSelect {
  #private = 0;
}

type SelectorFn<T> = (payload: {
  body: Record<string, BodySelect>;
  query: Record<string, QuerySelect>;
  queries: Record<string, QueriesSelect>;
  params: Record<string, ParamsSelect>;
  headers: Record<string, HeadersSelect>;
}) => T;
type ValidateMiddleware<T extends ValidatorConfig> = MiddlewareHandler<
  {
    Variables: {
      input: ExtractInput<T>;
    };
  },
  string,
  { in: InferIn<T> }
>;

export function validate<T extends ValidatorConfig>(
  selector: SelectorFn<T>,
): ValidateMiddleware<T>;
export function validate<T extends ValidatorConfig>(
  expectedContentTypeOrSelector: ContentType,
  selector: SelectorFn<T>,
): ValidateMiddleware<T>;
export function validate<T extends ValidatorConfig>(
  expectedContentTypeOrSelector: ContentType | SelectorFn<T>,
  selector?: SelectorFn<T>,
): ValidateMiddleware<T> {
  const expectedContentType =
    typeof expectedContentTypeOrSelector === 'string'
      ? expectedContentTypeOrSelector
      : undefined;
  const _selector =
    typeof expectedContentTypeOrSelector === 'function'
      ? expectedContentTypeOrSelector
      : selector;
  if (!_selector) {
    throw new Error('Selector function is required');
  }

  return createMiddleware(async (c, next) => {
    const ct = c.req.header('content-type');
    if (expectedContentType) {
      verifyContentType(ct, expectedContentType);
    }

    const contentType = ct ? parseContentType(ct) : null;
    let body: unknown = null;

    switch (contentType?.type) {
      case 'application/json':
        body = await c.req.json();
        break;
      case 'application/x-www-form-urlencoded':
      case 'multipart/form-data':
        body = await c.req.parseBody();
        break;
      default:
        body = {};
    }

    const payload = {
      body,
      query: c.req.query(),
      queries: c.req.queries(),
      params: c.req.param(),
      headers: Object.fromEntries(
        Object.entries(c.req.header()).map(([k, v]) => [k, v ?? '']),
      ),
    };

    const config = _selector(payload as never);
    const schema = z.object(
      Object.entries(config).reduce(
        (acc, [key, value]) => {
          acc[key] = value.against;
          return acc;
        },
        {} as Record<string, z.ZodTypeAny>,
      ),
    );

    const input = Object.entries(config).reduce(
      (acc, [key, value]) => {
        acc[key] = value.select;
        return acc;
      },
      {} as Record<string, unknown>,
    );

    const parsed = await parse(schema, input);
    c.set('input', parsed as ExtractInput<T>);
    await next();
  });
}

export async function parse<T extends z.ZodRawShape>(
  schema: z.ZodObject<T>,
  input: unknown,
) {
  const result = await schema.safeParseAsync(input);
  if (!result.success) {
    const error = new HTTPException(400, {
      message: 'Validation failed',
      cause: {
        code: 'api/validation-failed',
        detail: 'The input data is invalid',
        errors: result.error.flatten((issue) => ({
          message: issue.message,
          code: issue.code,
          fatal: issue.fatal,
          path: issue.path.join('.'),
        })).fieldErrors,
      },
    });
    throw error;
  }
  return result.data;
}

export const openapi = validate;

export const consume = (contentType: ContentType) => {
  return createMiddleware(async (context, next) => {
    verifyContentType(context.req.header('content-type'), contentType);
    await next();
  });
};

export function verifyContentType(
  actual: string | undefined,
  expected: ContentType,
): asserts actual is ContentType {
  if (!actual) {
    throw new HTTPException(415, {
      message: 'Unsupported Media Type',
      cause: {
        code: 'api/unsupported-media-type',
        details: 'Missing content type header',
      },
    });
  }
  const { type: incomingContentType } = parseContentType(actual);
  if (incomingContentType !== expected) {
    throw new HTTPException(415, {
      message: 'Unsupported Media Type',
      cause: {
        code: 'api/unsupported-media-type',
        details: `Expected content type: ${expected}, but got: ${incomingContentType}`,
      },
    });
  }
}
