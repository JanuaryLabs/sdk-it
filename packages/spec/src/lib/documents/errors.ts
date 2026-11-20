function reason(cause: unknown) {
  return Error.isError(cause) ? cause.message : String(cause);
}

/** A source could not return the text of the document at `url`, such as an http status that is not ok. */
export class DocumentReadError extends Error {
  readonly url: URL;
  constructor(url: URL, message: string) {
    super(message);
    this.name = 'DocumentReadError';
    this.url = url;
  }
}

/** No parser could read the text of the document at `url`. */
export class DocumentParseError extends Error {
  readonly url: URL;
  constructor(url: URL, options: { cause: unknown }) {
    super(`Could not parse ${url.href}: ${reason(options.cause)}`, options);
    this.name = 'DocumentParseError';
    this.url = url;
  }
}

/** Where a Reference Object sits: the URI of its document, when that has one, and its JSON Pointer tokens there (RFC 6901, unescaped). */
export interface ReferenceLocation {
  readonly document: string | undefined;
  readonly tokens: readonly string[];
}

/** A `$ref` whose target could not be read. `cause` says why. */
export class UnresolvedReferenceError extends Error {
  readonly ref: string;
  readonly location: ReferenceLocation;
  constructor(
    ref: string,
    location: ReferenceLocation,
    options: { cause: unknown },
  ) {
    super(
      location.document === undefined
        ? `Could not resolve $ref ${ref}: ${reason(options.cause)}`
        : `Could not resolve $ref ${ref} from ${location.document}: ${reason(options.cause)}`,
      options,
    );
    this.name = 'UnresolvedReferenceError';
    this.ref = ref;
    this.location = location;
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
