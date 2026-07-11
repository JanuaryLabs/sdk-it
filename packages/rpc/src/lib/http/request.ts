type Init = Omit<RequestInit, 'headers'> & { headers: Headers };
export type RequestConfig = { init: Init; url: URL };
export type Method =
  'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
export type ContentType =
  'xml' | 'json' | 'urlencoded' | 'multipart' | 'formdata';
export type HeadersInit = [string, string][] | Record<string, string>;
export type Endpoint =
  `${ContentType} ${Method} ${string}` | `${Method} ${string}`;

export type BodyInit =
  ArrayBuffer | Blob | FormData | URLSearchParams | null | string;

function template(
  templateString: string,
  templateVariables: Record<string, any>,
): string {
  const nargs = /{([0-9a-zA-Z_]+)}/g;
  return templateString.replace(nargs, (match, key: string, index: number) => {
    // Handle escaped double braces
    if (
      templateString[index - 1] === '{' &&
      templateString[index + match.length] === '}'
    ) {
      return key;
    }

    const result = key in templateVariables ? templateVariables[key] : null;
    return result === null || result === undefined ? '' : String(result);
  });
}

type Input = Record<string, any>;

// Validated inputs can carry Date (coerce-date) values; String(new Date())
// yields a local-time RFC 2822 string, so serialize Dates as ISO 8601.
function toWireValue(value: any): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

type Props = {
  inputHeaders: string[];
  inputQuery: string[];
  inputBody: string[];
  inputParams: string[];
};

abstract class Serializer {
  protected input: Input;
  protected props: Props;

  constructor(input: Input, props: Props) {
    this.input = input;
    this.props = props;
  }

  abstract getBody(): BodyInit | null;
  abstract getHeaders(): Record<string, string>;
  serialize(path: string): Serialized {
    const params = this.props.inputParams.reduce<Record<string, any>>(
      (acc, key) => {
        acc[key] = this.input[key];
        return acc;
      },
      {},
    );
    const url = new URL(template(path, params), `local://`);

    const headers: Record<string, string> = { ...this.getHeaders() };
    for (const header of this.props.inputHeaders) {
      const value = this.input[header];
      if (value !== undefined) {
        headers[header] = toWireValue(value);
      }
    }

    for (const key of this.props.inputQuery) {
      const value = this.input[key];
      if (value !== undefined) {
        if (Array.isArray(value)) {
          for (const item of value) {
            url.searchParams.append(key, toWireValue(item));
          }
        } else {
          url.searchParams.set(key, toWireValue(value));
        }
      }
    }

    return {
      body: this.getBody(),
      url,
      headers,
    };
  }
}

interface Serialized {
  body: BodyInit | null;
  headers: Record<string, string>;
  url: URL;
}

class JsonSerializer extends Serializer {
  getBody(): BodyInit | null {
    const body: Record<string, any> = {};
    if (
      this.props.inputBody.length === 1 &&
      this.props.inputBody[0] === '$body'
    ) {
      return JSON.stringify(this.input.$body);
    }

    for (const prop of this.props.inputBody) {
      body[prop] = this.input[prop];
    }
    return JSON.stringify(body);
  }
  getHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }
}

class UrlencodedSerializer extends Serializer {
  getBody(): BodyInit | null {
    const body = new URLSearchParams();
    for (const prop of this.props.inputBody) {
      body.set(prop, toWireValue(this.input[prop]));
    }
    return body;
  }
  getHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    };
  }
}

class EmptySerializer extends Serializer {
  getBody(): BodyInit | null {
    return null;
  }
  getHeaders(): Record<string, string> {
    return {};
  }
}

class FormDataSerializer extends Serializer {
  getBody(): BodyInit | null {
    const body = new FormData();
    for (const prop of this.props.inputBody) {
      body.append(prop, this.input[prop]);
    }
    return body;
  }
  getHeaders(): Record<string, string> {
    return {
      Accept: 'application/json',
    };
  }
}

export function json(input: Input, props: Props) {
  return new JsonSerializer(input, props);
}
export function urlencoded(input: Input, props: Props) {
  return new UrlencodedSerializer(input, props);
}
export function empty(input: Input, props: Props) {
  return new EmptySerializer(input, props);
}
export function formdata(input: Input, props: Props) {
  return new FormDataSerializer(input, props);
}

export function toRequest<T extends Endpoint>(
  endpoint: T,
  serializer: Serializer,
): RequestConfig {
  const [method, path] = endpoint.split(' ');
  const input = serializer.serialize(path);
  return {
    url: input.url,
    init: {
      method: method,
      headers: new Headers(input.headers),
      body: method === 'GET' ? undefined : input.body,
    },
  };
}
