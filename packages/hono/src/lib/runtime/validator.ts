import { safeParse } from 'fast-content-type-parse';
import type { MiddlewareHandler, ValidationTargets } from 'hono';
import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import z from 'zod';

type ContentType =
  | 'application/json'
  | 'application/x-www-form-urlencoded'
  | 'multipart/form-data'
  | 'text/plain';

// z.ZodType<any> mirrors zod v3's ZodTypeAny: with the default `unknown`
// output, concrete middlewares stop being assignable to
// ValidateMiddleware<ValidatorConfig>.

type ValidatorConfig = Record<
  string,
  { select: unknown; against: z.ZodType<any> }
>;

type ExtractInput<T extends ValidatorConfig> = z.output<
  z.ZodObject<{ [K in keyof T]: T[K]['against'] }>
>;

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

// Type-only markers distinguish request sources; no marker objects exist at runtime.
type Select<Target extends string> = {
  readonly validationTarget: Target;
};

type BodySelect = Select<'body'>;
type QuerySelect = Select<'query'>;
type QueriesSelect = Select<'queries'>;
type ParamsSelect = Select<'params'>;
type HeadersSelect = Select<'headers'>;
type CookieSelect = Select<'cookie'>;

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

/** Validate selected request values and expose Zod's parsed output as `c.var.input`. */
export function validate<T extends ValidatorConfig>(
  selector: SelectorFn<T>,
): ValidateMiddleware<T>;
/** Enforce a content type before validating the selected request values. */
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
    if (c.req.method === 'GET' && ct) {
      throw new HTTPException(415, {
        message: 'Unsupported Media Type',
        cause: {
          code: 'api/unsupported-media-type',
          detail: `GET requests cannot have a content type header`,
        },
      });
    }
    if (expectedContentType) {
      verifyContentType(ct, expectedContentType);
    }

    const contentType = ct ? parseContentType(ct) : null;
    let body: unknown = null;

    switch (contentType?.type) {
      case 'application/json':
        try {
          body = await c.req.json();
        } catch {
          throw new HTTPException(400, {
            message: 'Invalid JSON body',
            cause: {
              code: 'api/invalid-json',
              detail: 'Request body must be valid JSON.',
            },
          });
        }
        break;
      case 'application/x-www-form-urlencoded':
      case 'multipart/form-data':
        body = await c.req.parseBody({ all: true });
        break;
      default:
        body = {};
    }

    // Whole-body schemas may accept any JSON value. A field selector, however,
    // requires an object: guard the property read itself rather than catching
    // arbitrary errors thrown by the application's selector.
    const selectedBody =
      body !== null && typeof body === 'object' && !Array.isArray(body)
        ? body
        : new Proxy(
            {},
            {
              get() {
                throw new HTTPException(400, {
                  message: 'Invalid request body',
                  cause: {
                    code: 'api/invalid-body',
                    detail:
                      'Request body must be an object when selecting fields.',
                  },
                });
              },
            },
          );
    const payload = {
      body: selectedBody,
      query: c.req.query(),
      queries: c.req.queries(),
      params: c.req.param(),
      headers: c.req.header(),
    };

    const config = _selector(payload as never);
    const schema = z.object(
      Object.fromEntries(
        Object.entries(config).map(([key, value]) => [key, value.against]),
      ),
    );

    const input = Object.fromEntries(
      Object.entries(config).map(([key, value]) => [
        key,
        value.select === selectedBody ? body : value.select,
      ]),
    );

    const parsed = await parse(schema, input);
    c.set('input', parsed as ExtractInput<T>);
    await next();
  });
}

/** Parse any Zod schema asynchronously, throwing a structured HTTP 400 on rejection. */
export async function parse<T extends z.ZodType>(
  schema: T,
  input: unknown,
): Promise<z.output<T>> {
  const result = await schema.safeParseAsync(input);
  if (!result.success) {
    const { fieldErrors, formErrors } = z.flattenError(
      result.error,
      (issue) => ({
        message: issue.message,
        code: issue.code,
        path: issue.path.join('.'),
      }),
    );
    const error = new HTTPException(400, {
      message: 'Validation failed',
      cause: {
        code: 'api/validation-failed',
        detail: 'The input data is invalid',
        errors: fieldErrors,
        formErrors,
      },
    });
    throw error;
  }
  return result.data;
}

export const openapi = validate;

/** Enforce a request content type without reading or validating its body. */
export const consume = (contentType: ContentType) => {
  return createMiddleware(async (context, next) => {
    verifyContentType(context.req.header('content-type'), contentType);
    await next();
  });
};

function parseContentType(header: string) {
  const contentType = safeParse(header);
  if (!contentType.type) {
    throw new HTTPException(415, {
      message: 'Unsupported Media Type',
      cause: {
        code: 'api/unsupported-media-type',
        detail: 'Invalid content type header',
      },
    });
  }
  return contentType;
}

export function verifyContentType(
  actual: string | undefined,
  expected: ContentType,
): asserts actual is ContentType {
  if (!actual) {
    throw new HTTPException(415, {
      message: 'Unsupported Media Type',
      cause: {
        code: 'api/unsupported-media-type',
        detail: 'Missing content type header',
      },
    });
  }
  const { type: incomingContentType } = parseContentType(actual);
  if (incomingContentType !== expected) {
    throw new HTTPException(415, {
      message: 'Unsupported Media Type',
      cause: {
        code: 'api/unsupported-media-type',
        detail: `Expected content type: ${expected}, but got: ${incomingContentType}`,
      },
    });
  }
}
