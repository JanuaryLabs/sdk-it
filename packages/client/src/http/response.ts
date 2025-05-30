export const KIND = Symbol('APIDATA');

export class APIResponse<Body = unknown, Status extends number = number> {
  static readonly status: number;
  static readonly kind: symbol = Symbol.for('APIResponse');
  status: Status;
  data: Body;

  constructor(status: Status, data: Body) {
    this.status = status;
    this.data = data;
  }

  static create<Body = unknown>(status: number, data: Body) {
    return new this(status, data);
  }
}

export class APIError<Body, Status extends number = number> extends APIResponse<
  Body,
  Status
> {
  static override create<T>(status: number, data: T) {
    return new this(status, data);
  }
}

// 2xx Success
export class Ok<T> extends APIResponse<T, 200> {
  static override readonly kind = Symbol.for('Ok');
  static override readonly status = 200 as const;
  constructor(data: T) {
    super(Ok.status, data);
  }
  static override create<T>(status: number, data: T) {
    Object.defineProperty(data, KIND, { value: this.kind });
    return new this(data);
  }

  static is<T extends { [KIND]: (typeof Ok)['kind'] }>(
    value: unknown,
  ): value is T {
    return (
      typeof value === 'object' &&
      value !== null &&
      KIND in value &&
      value[KIND] === this.kind
    );
  }
}

export class Created<T> extends APIResponse<T, 201> {
  static override readonly kind = Symbol.for('Created');
  static override status = 201 as const;
  constructor(data: T) {
    super(Created.status, data);
  }
  static override create<T>(status: number, data: T) {
    Object.defineProperty(data, KIND, { value: this.kind });
    return new this(data);
  }

  static is<T extends { [KIND]: (typeof Created)['kind'] }>(
    value: unknown,
  ): value is T {
    return (
      typeof value === 'object' &&
      value !== null &&
      KIND in value &&
      value[KIND] === this.kind
    );
  }
}
export class Accepted<T> extends APIResponse<T, 202> {
  static override readonly kind = Symbol.for('Accepted');
  static override status = 202 as const;
  constructor(data: T) {
    super(Accepted.status, data);
  }
  static override create<T>(status: number, data: T) {
    Object.defineProperty(data, KIND, { value: this.kind });
    return new this(data);
  }

  static is<T extends { [KIND]: (typeof Accepted)['kind'] }>(
    value: unknown,
  ): value is T {
    return (
      typeof value === 'object' &&
      value !== null &&
      KIND in value &&
      value[KIND] === this.kind
    );
  }
}
export class NoContent extends APIResponse<never, 204> {
  static override readonly kind = Symbol.for('NoContent');
  static override status = 204 as const;
  constructor() {
    super(NoContent.status, null as never);
  }
  static override create(status: number, data: never): NoContent {
    return new this();
  }

  static is<T extends { [KIND]: (typeof NoContent)['kind'] }>(
    value: unknown,
  ): value is T {
    return (
      typeof value === 'object' &&
      value !== null &&
      KIND in value &&
      value[KIND] === this.kind
    );
  }
}

// 4xx Client Errors
export class BadRequest<T> extends APIError<T, 400> {
  static override readonly kind = Symbol.for('BadRequest');
  static override status = 400 as const;
  constructor(data: T) {
    super(BadRequest.status, data);
  }
  static override create<T>(status: number, data: T) {
    Object.defineProperty(data, KIND, { value: this.kind });
    return new this(data);
  }

  static is<T extends { [KIND]: (typeof BadRequest)['kind'] }>(
    value: unknown,
  ): value is T {
    return (
      typeof value === 'object' &&
      value !== null &&
      KIND in value &&
      value[KIND] === this.kind
    );
  }
}
export class Unauthorized<T = { message: string }> extends APIError<T, 401> {
  static override readonly kind = Symbol.for('Unauthorized');
  static override status = 401 as const;
  constructor(data: T) {
    super(Unauthorized.status, data);
  }
  static override create<T>(status: number, data: T) {
    Object.defineProperty(data, KIND, { value: this.kind });
    return new this(data);
  }

  static is<T extends { [KIND]: (typeof Unauthorized)['kind'] }>(
    value: unknown,
  ): value is T {
    return (
      typeof value === 'object' &&
      value !== null &&
      KIND in value &&
      value[KIND] === this.kind
    );
  }
}
export class PaymentRequired<T = { message: string }> extends APIError<T, 402> {
  static override readonly kind = Symbol.for('PaymentRequired');
  static override status = 402 as const;
  constructor(data: T) {
    super(PaymentRequired.status, data);
  }
  static override create<T>(status: number, data: T) {
    Object.defineProperty(data, KIND, { value: this.kind });
    return new this(data);
  }

  static is<T extends { [KIND]: (typeof PaymentRequired)['kind'] }>(
    value: unknown,
  ): value is T {
    return (
      typeof value === 'object' &&
      value !== null &&
      KIND in value &&
      value[KIND] === this.kind
    );
  }
}
export class Forbidden<T = { message: string }> extends APIError<T, 403> {
  static override readonly kind = Symbol.for('Forbidden');
  static override status = 403 as const;
  constructor(data: T) {
    super(Forbidden.status, data);
  }
  static override create<T>(status: number, data: T) {
    Object.defineProperty(data, KIND, { value: this.kind });
    return new this(data);
  }

  static is<T extends { [KIND]: (typeof Forbidden)['kind'] }>(
    value: unknown,
  ): value is T {
    return (
      typeof value === 'object' &&
      value !== null &&
      KIND in value &&
      value[KIND] === this.kind
    );
  }
}
export class NotFound<T = { message: string }> extends APIError<T, 404> {
  static override readonly kind = Symbol.for('NotFound');
  static override status = 404 as const;
  constructor(data: T) {
    super(NotFound.status, data);
  }
  static override create<T>(status: number, data: T) {
    Object.defineProperty(data, KIND, { value: this.kind });
    return new this(data);
  }

  static is<T extends { [KIND]: (typeof NotFound)['kind'] }>(
    value: unknown,
  ): value is T {
    return (
      typeof value === 'object' &&
      value !== null &&
      KIND in value &&
      value[KIND] === this.kind
    );
  }
}
export class MethodNotAllowed<T = { message: string }> extends APIError<
  T,
  405
> {
  static override readonly kind = Symbol.for('MethodNotAllowed');
  static override status = 405 as const;
  constructor(data: T) {
    super(MethodNotAllowed.status, data);
  }
  static override create<T>(status: number, data: T) {
    Object.defineProperty(data, KIND, { value: this.kind });
    return new this(data);
  }

  static is<T extends { [KIND]: (typeof MethodNotAllowed)['kind'] }>(
    value: unknown,
  ): value is T {
    return (
      typeof value === 'object' &&
      value !== null &&
      KIND in value &&
      value[KIND] === this.kind
    );
  }
}
export class NotAcceptable<T = { message: string }> extends APIError<T, 406> {
  static override readonly kind = Symbol.for('NotAcceptable');
  static override status = 406 as const;
  constructor(data: T) {
    super(NotAcceptable.status, data);
  }
  static override create<T>(status: number, data: T) {
    Object.defineProperty(data, KIND, { value: this.kind });
    return new this(data);
  }

  static is<T extends { [KIND]: (typeof NotAcceptable)['kind'] }>(
    value: unknown,
  ): value is T {
    return (
      typeof value === 'object' &&
      value !== null &&
      KIND in value &&
      value[KIND] === this.kind
    );
  }
}
export class Conflict<T = { message: string }> extends APIError<T, 409> {
  static override readonly kind = Symbol.for('Conflict');
  static override status = 409 as const;
  constructor(data: T) {
    super(Conflict.status, data);
  }
  static override create<T>(status: number, data: T) {
    Object.defineProperty(data, KIND, { value: this.kind });
    return new this(data);
  }

  static is<T extends { [KIND]: (typeof Conflict)['kind'] }>(
    value: unknown,
  ): value is T {
    return (
      typeof value === 'object' &&
      value !== null &&
      KIND in value &&
      value[KIND] === this.kind
    );
  }
}
export class Gone<T = { message: string }> extends APIError<T, 410> {
  static override readonly kind = Symbol.for('Gone');
  static override status = 410 as const;
  constructor(data: T) {
    super(Gone.status, data);
  }
  static override create<T>(status: number, data: T) {
    Object.defineProperty(data, KIND, { value: this.kind });
    return new this(data);
  }

  static is<T extends { [KIND]: (typeof Gone)['kind'] }>(
    value: unknown,
  ): value is T {
    return (
      typeof value === 'object' &&
      value !== null &&
      KIND in value &&
      value[KIND] === this.kind
    );
  }
}
export class PreconditionFailed<T = { message: string }> extends APIError<
  T,
  412
> {
  static override readonly kind = Symbol.for('PreconditionFailed');
  static override status = 412 as const;
  constructor(data: T) {
    super(PreconditionFailed.status, data);
  }
  static override create<T>(status: number, data: T) {
    Object.defineProperty(data, KIND, { value: this.kind });
    return new this(data);
  }

  static is<T extends { [KIND]: (typeof PreconditionFailed)['kind'] }>(
    value: unknown,
  ): value is T {
    return (
      typeof value === 'object' &&
      value !== null &&
      KIND in value &&
      value[KIND] === this.kind
    );
  }
}
export class UnprocessableEntity<
  T = { message: string; errors?: Record<string, string[]> },
> extends APIError<T, 422> {
  static override readonly kind = Symbol.for('UnprocessableEntity');
  static override status = 422 as const;
  constructor(data: T) {
    super(UnprocessableEntity.status, data);
  }
  static override create<T>(status: number, data: T) {
    Object.defineProperty(data, KIND, { value: this.kind });
    return new this(data);
  }

  static is<T extends { [KIND]: (typeof UnprocessableEntity)['kind'] }>(
    value: unknown,
  ): value is T {
    return (
      typeof value === 'object' &&
      value !== null &&
      KIND in value &&
      value[KIND] === this.kind
    );
  }
}
export class TooManyRequests<
  T = { message: string; retryAfter?: string },
> extends APIError<T, 429> {
  static override readonly kind = Symbol.for('TooManyRequests');
  static override status = 429 as const;
  constructor(data: T) {
    super(TooManyRequests.status, data);
  }
  static override create<T>(status: number, data: T) {
    Object.defineProperty(data, KIND, { value: this.kind });
    return new this(data);
  }

  static is<T extends { [KIND]: (typeof TooManyRequests)['kind'] }>(
    value: unknown,
  ): value is T {
    return (
      typeof value === 'object' &&
      value !== null &&
      KIND in value &&
      value[KIND] === this.kind
    );
  }
}
export class PayloadTooLarge<T = { message: string }> extends APIError<T, 413> {
  static override readonly kind = Symbol.for('PayloadTooLarge');
  static override status = 413 as const;
  constructor(data: T) {
    super(PayloadTooLarge.status, data);
  }
  static override create<T>(status: number, data: T) {
    Object.defineProperty(data, KIND, { value: this.kind });
    return new this(data);
  }

  static is<T extends { [KIND]: (typeof PayloadTooLarge)['kind'] }>(
    value: unknown,
  ): value is T {
    return (
      typeof value === 'object' &&
      value !== null &&
      KIND in value &&
      value[KIND] === this.kind
    );
  }
}
export class UnsupportedMediaType<T = { message: string }> extends APIError<
  T,
  415
> {
  static override readonly kind = Symbol.for('UnsupportedMediaType');
  static override status = 415 as const;
  constructor(data: T) {
    super(UnsupportedMediaType.status, data);
  }
  static override create<T>(status: number, data: T) {
    Object.defineProperty(data, KIND, { value: this.kind });
    return new this(data);
  }

  static is<T extends { [KIND]: (typeof UnsupportedMediaType)['kind'] }>(
    value: unknown,
  ): value is T {
    return (
      typeof value === 'object' &&
      value !== null &&
      KIND in value &&
      value[KIND] === this.kind
    );
  }
}

// 5xx Server Errors
export class InternalServerError<T = { message: string }> extends APIError<
  T,
  500
> {
  static override readonly kind = Symbol.for('InternalServerError');
  static override status = 500 as const;
  constructor(data: T) {
    super(InternalServerError.status, data);
  }
  static override create<T>(status: number, data: T) {
    Object.defineProperty(data, KIND, { value: this.kind });
    return new this(data);
  }

  static is<T extends { [KIND]: (typeof InternalServerError)['kind'] }>(
    value: unknown,
  ): value is T {
    return (
      typeof value === 'object' &&
      value !== null &&
      KIND in value &&
      value[KIND] === this.kind
    );
  }
}
export class NotImplemented<T = { message: string }> extends APIError<T, 501> {
  static override readonly kind = Symbol.for('NotImplemented');
  static override status = 501 as const;
  constructor(data: T) {
    super(NotImplemented.status, data);
  }
  static override create<T>(status: number, data: T) {
    Object.defineProperty(data, KIND, { value: this.kind });
    return new this(data);
  }

  static is<T extends { [KIND]: (typeof NotImplemented)['kind'] }>(
    value: unknown,
  ): value is T {
    return (
      typeof value === 'object' &&
      value !== null &&
      KIND in value &&
      value[KIND] === this.kind
    );
  }
}
export class BadGateway<T = { message: string }> extends APIError<T, 502> {
  static override readonly kind = Symbol.for('BadGateway');
  static override status = 502 as const;
  constructor(data: T) {
    super(BadGateway.status, data);
  }
  static override create<T>(status: number, data: T) {
    Object.defineProperty(data, KIND, { value: this.kind });
    return new this(data);
  }

  static is<T extends { [KIND]: (typeof BadGateway)['kind'] }>(
    value: unknown,
  ): value is T {
    return (
      typeof value === 'object' &&
      value !== null &&
      KIND in value &&
      value[KIND] === this.kind
    );
  }
}
export class ServiceUnavailable<
  T = { message: string; retryAfter?: string },
> extends APIError<T, 503> {
  static override readonly kind = Symbol.for('ServiceUnavailable');
  static override status = 503 as const;
  constructor(data: T) {
    super(ServiceUnavailable.status, data);
  }
  static override create<T>(status: number, data: T) {
    Object.defineProperty(data, KIND, { value: this.kind });
    return new this(data);
  }

  static is<T extends { [KIND]: (typeof ServiceUnavailable)['kind'] }>(
    value: unknown,
  ): value is T {
    return (
      typeof value === 'object' &&
      value !== null &&
      KIND in value &&
      value[KIND] === this.kind
    );
  }
}
export class GatewayTimeout<T = { message: string }> extends APIError<T, 504> {
  static override readonly kind = Symbol.for('GatewayTimeout');
  static override status = 504 as const;
  constructor(data: T) {
    super(GatewayTimeout.status, data);
  }
  static override create<T>(status: number, data: T) {
    Object.defineProperty(data, KIND, { value: this.kind });
    return new this(data);
  }

  static is<T extends { [KIND]: (typeof GatewayTimeout)['kind'] }>(
    value: unknown,
  ): value is T {
    return (
      typeof value === 'object' &&
      value !== null &&
      KIND in value &&
      value[KIND] === this.kind
    );
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

export type SuccessfulResponse =
  | Ok<unknown>
  | Created<unknown>
  | Accepted<unknown>
  | NoContent;
