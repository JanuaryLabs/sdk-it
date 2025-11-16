export class APIResponse<Body = unknown, Status extends number = number> {
  static readonly status: number;
  readonly status: Status;
  data: Body;
  readonly headers: Headers;

  constructor(status: Status, headers: Headers, data: Body) {
    this.status = status;
    this.headers = headers;
    this.data = data;
  }

  static create<Body = unknown>(status: number, headers: Headers, data: Body) {
    return new this(status, headers, data);
  }
}

export class APIError<Body, Status extends number = number> extends APIResponse<
  Body,
  Status
> {
  static override create<T>(status: number, headers: Headers, data: T) {
    return new this(status, headers, data);
  }
}

// 2xx Success
export class Ok<T> extends APIResponse<T, 200> {
  static override readonly status = 200 as const;
  constructor(headers: Headers, data: T) {
    super(Ok.status, headers, data);
  }
  static override create<T>(status: number, headers: Headers, data: T) {
    return new this(headers, data);
  }
}

export class Created<T> extends APIResponse<T, 201> {
  static override status = 201 as const;
  constructor(headers: Headers, data: T) {
    super(Created.status, headers, data);
  }
  static override create<T>(status: number, headers: Headers, data: T) {
    return new this(headers, data);
  }
}
export class Accepted<T> extends APIResponse<T, 202> {
  static override status = 202 as const;
  constructor(headers: Headers, data: T) {
    super(Accepted.status, headers, data);
  }
  static override create<T>(status: number, headers: Headers, data: T) {
    return new this(headers, data);
  }
}
export class NoContent extends APIResponse<never, 204> {
  static override status = 204 as const;
  constructor(headers: Headers) {
    super(NoContent.status, headers, null as never);
  }
  static override create(status: number, headers: Headers): NoContent {
    return new this(headers);
  }
}

// 4xx Client Errors
export class BadRequest<T> extends APIError<T, 400> {
  static override status = 400 as const;
  constructor(headers: Headers, data: T) {
    super(BadRequest.status, headers, data);
  }
  static override create<T>(status: number, headers: Headers, data: T) {
    return new this(headers, data);
  }
}
export class Unauthorized<T = { message: string }> extends APIError<T, 401> {
  static override status = 401 as const;
  constructor(headers: Headers, data: T) {
    super(Unauthorized.status, headers, data);
  }
  static override create<T>(status: number, headers: Headers, data: T) {
    return new this(headers, data);
  }
}
export class PaymentRequired<T = { message: string }> extends APIError<T, 402> {
  static override status = 402 as const;
  constructor(headers: Headers, data: T) {
    super(PaymentRequired.status, headers, data);
  }
  static override create<T>(status: number, headers: Headers, data: T) {
    return new this(headers, data);
  }
}
export class Forbidden<T = { message: string }> extends APIError<T, 403> {
  static override status = 403 as const;
  constructor(headers: Headers, data: T) {
    super(Forbidden.status, headers, data);
  }
  static override create<T>(status: number, headers: Headers, data: T) {
    return new this(headers, data);
  }
}
export class NotFound<T = { message: string }> extends APIError<T, 404> {
  static override status = 404 as const;
  constructor(headers: Headers, data: T) {
    super(NotFound.status, headers, data);
  }
  static override create<T>(status: number, headers: Headers, data: T) {
    return new this(headers, data);
  }
}
export class MethodNotAllowed<T = { message: string }> extends APIError<
  T,
  405
> {
  static override status = 405 as const;
  constructor(headers: Headers, data: T) {
    super(MethodNotAllowed.status, headers, data);
  }
  static override create<T>(status: number, headers: Headers, data: T) {
    return new this(headers, data);
  }
}
export class NotAcceptable<T = { message: string }> extends APIError<T, 406> {
  static override status = 406 as const;
  constructor(headers: Headers, data: T) {
    super(NotAcceptable.status, headers, data);
  }
  static override create<T>(status: number, headers: Headers, data: T) {
    return new this(headers, data);
  }
}
export class Conflict<T = { message: string }> extends APIError<T, 409> {
  static override status = 409 as const;
  constructor(headers: Headers, data: T) {
    super(Conflict.status, headers, data);
  }
  static override create<T>(status: number, headers: Headers, data: T) {
    return new this(headers, data);
  }
}
export class Gone<T = { message: string }> extends APIError<T, 410> {
  static override status = 410 as const;
  constructor(headers: Headers, data: T) {
    super(Gone.status, headers, data);
  }
  static override create<T>(status: number, headers: Headers, data: T) {
    return new this(headers, data);
  }
}
export class PreconditionFailed<T = { message: string }> extends APIError<
  T,
  412
> {
  static override status = 412 as const;
  constructor(headers: Headers, data: T) {
    super(PreconditionFailed.status, headers, data);
  }
  static override create<T>(status: number, headers: Headers, data: T) {
    return new this(headers, data);
  }
}
export class UnprocessableEntity<
  T = { message: string; errors?: Record<string, string[]> },
> extends APIError<T, 422> {
  static override status = 422 as const;
  constructor(headers: Headers, data: T) {
    super(UnprocessableEntity.status, headers, data);
  }
  static override create<T>(status: number, headers: Headers, data: T) {
    return new this(headers, data);
  }
}
export class TooManyRequests<
  T = { message: string; retryAfter?: string },
> extends APIError<T, 429> {
  static override status = 429 as const;
  constructor(headers: Headers, data: T) {
    super(TooManyRequests.status, headers, data);
  }
  static override create<T>(status: number, headers: Headers, data: T) {
    return new this(headers, data);
  }
}
export class PayloadTooLarge<T = { message: string }> extends APIError<T, 413> {
  static override status = 413 as const;
  constructor(headers: Headers, data: T) {
    super(PayloadTooLarge.status, headers, data);
  }
  static override create<T>(status: number, headers: Headers, data: T) {
    return new this(headers, data);
  }
}
export class UnsupportedMediaType<T = { message: string }> extends APIError<
  T,
  415
> {
  static override status = 415 as const;
  constructor(headers: Headers, data: T) {
    super(UnsupportedMediaType.status, headers, data);
  }
  static override create<T>(status: number, headers: Headers, data: T) {
    return new this(headers, data);
  }
}

// 5xx Server Errors
export class InternalServerError<T = { message: string }> extends APIError<
  T,
  500
> {
  static override status = 500 as const;
  constructor(headers: Headers, data: T) {
    super(InternalServerError.status, headers, data);
  }
  static override create<T>(status: number, headers: Headers, data: T) {
    return new this(headers, data);
  }
}
export class NotImplemented<T = { message: string }> extends APIError<T, 501> {
  static override status = 501 as const;
  constructor(headers: Headers, data: T) {
    super(NotImplemented.status, headers, data);
  }
  static override create<T>(status: number, headers: Headers, data: T) {
    return new this(headers, data);
  }
}
export class BadGateway<T = { message: string }> extends APIError<T, 502> {
  static override status = 502 as const;
  constructor(headers: Headers, data: T) {
    super(BadGateway.status, headers, data);
  }
  static override create<T>(status: number, headers: Headers, data: T) {
    return new this(headers, data);
  }
}
export class ServiceUnavailable<
  T = { message: string; retryAfter?: string },
> extends APIError<T, 503> {
  static override status = 503 as const;
  constructor(headers: Headers, data: T) {
    super(ServiceUnavailable.status, headers, data);
  }
  static override create<T>(status: number, headers: Headers, data: T) {
    return new this(headers, data);
  }
}
export class GatewayTimeout<T = { message: string }> extends APIError<T, 504> {
  static override status = 504 as const;
  constructor(headers: Headers, data: T) {
    super(GatewayTimeout.status, headers, data);
  }
  static override create<T>(status: number, headers: Headers, data: T) {
    return new this(headers, data);
  }
}

export type ClientError =
  | BadRequest<unknown>
  | Unauthorized<unknown>
  | PaymentRequired<unknown>
  | Forbidden<unknown>
  | NotFound<unknown>
  | MethodNotAllowed<unknown>
  | NotAcceptable<unknown>
  | Conflict<unknown>
  | Gone<unknown>
  | PreconditionFailed<unknown>
  | PayloadTooLarge<unknown>
  | UnsupportedMediaType<unknown>
  | UnprocessableEntity<unknown>
  | TooManyRequests<unknown>;

export type ServerError =
  | InternalServerError<unknown>
  | NotImplemented<unknown>
  | BadGateway<unknown>
  | ServiceUnavailable<unknown>
  | GatewayTimeout<unknown>;

export type ProblematicResponse = ClientError | ServerError;

export type SuccessfulResponse<T = unknown> =
  | Ok<T>
  | Created<T>
  | Accepted<T>
  | NoContent;

export type RebindSuccessPayload<Resp, New> =
  Resp extends Ok<infer _>
    ? Ok<New>
    : Resp extends Created<infer _>
      ? Created<New>
      : Resp extends Accepted<infer _>
        ? Accepted<New>
        : Resp extends NoContent
          ? NoContent
          : Resp extends SuccessfulResponse<infer _>
            ? APIResponse<New, Resp['status']>
            : never;
