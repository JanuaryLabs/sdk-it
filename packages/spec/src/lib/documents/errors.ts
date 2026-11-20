function reason(cause: unknown) {
  return Error.isError(cause) ? cause.message : String(cause);
}

/** A `$ref` whose target could not be read. `cause` says why. */
export class UnresolvedReferenceError extends Error {
  readonly ref: string;
  /** The URI of the document that holds the reference, when it has one. */
  readonly base: string | undefined;
  constructor(
    ref: string,
    base: string | undefined,
    options: { cause: unknown },
  ) {
    super(
      base === undefined
        ? `Could not resolve $ref ${ref}: ${reason(options.cause)}`
        : `Could not resolve $ref ${ref} from ${base}: ${reason(options.cause)}`,
      options,
    );
    this.name = 'UnresolvedReferenceError';
    this.ref = ref;
    this.base = base;
  }
}

/** A security requirement URI (OpenAPI 3.2) whose Security Scheme Object could not be read. */
export class UnresolvedSecuritySchemeError extends Error {
  readonly uri: string;
  constructor(uri: string, options: { cause: unknown }) {
    super(
      `Could not resolve security scheme URI ${uri}: ${reason(options.cause)}`,
      options,
    );
    this.name = 'UnresolvedSecuritySchemeError';
    this.uri = uri;
  }
}
