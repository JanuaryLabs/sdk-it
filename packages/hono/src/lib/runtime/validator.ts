/* eslint-disable no-unused-private-class-members */
import type { MiddlewareHandler, ValidationTargets } from 'hono';
import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import z from 'zod';

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
    : { form: InferTarget<T, CookieSelect, 'cookie'> });

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

export const validate = <T extends ValidatorConfig>(
  selector: (payload: {
    body: Record<string, BodySelect>;
    query: Record<string, QuerySelect>;
    queries: Record<string, QueriesSelect>;
    params: Record<string, ParamsSelect>;
    headers: Record<string, HeadersSelect>;
  }) => T,
): MiddlewareHandler<
  {
    Variables: {
      input: ExtractInput<T>;
    };
  },
  string,
  { in: InferIn<T> }
> => {
  return createMiddleware<{
    Variables: {
      input: ExtractInput<T>;
    };
  }>(async (c, next) => {
    const contentType = c.req.header('content-type') ?? '';
    let body: unknown = null;

    switch (contentType) {
      case 'application/json':
        body = await c.req.json();
        break;
      case 'application/x-www-form-urlencoded':
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

    const config = selector(payload as never);
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

    const parsed = parse(schema, input);
    c.set('input', parsed as ExtractInput<T>);
    await next();
  });
};

export function parse<T extends z.ZodRawShape>(
  schema: z.ZodObject<T>,
  input: unknown,
) {
  const result = schema.safeParse(input);
  if (!result.success) {
    const error = new HTTPException(400, {
      message: 'Validation failed',
      cause: {
        code: 'api/validation-failed',
        detail: 'The input data is invalid',
        errors: result.error.flatten((issue) => ({
          message: issue.message,
          code: issue.code,
          fatel: issue.fatal,
          path: issue.path.join('.'),
        })).fieldErrors,
      },
    });
    throw error;
  }
  return result.data;
}

export const openapi = validate;

export const consume = (
  contentType: 'application/json' | 'application/x-www-form-urlencoded',
) => {
  return createMiddleware(async (context, next) => {
    const clientContentType = context.req.header('Content-Type');
    if (clientContentType !== contentType) {
      throw new HTTPException(415, {
        message: 'Unsupported Media Type',
        cause: {
          code: 'api/unsupported-media-type',
          detail: `Expected content type: ${contentType}, but got: ${clientContentType}`,
        },
      });
    }
    await next();
  });
};
