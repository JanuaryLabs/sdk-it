type Init = Omit<RequestInit, 'headers'> & { headers: Headers };
export type RequestConfig = { init: Init; url: URL };
export type Method =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'HEAD'
  | 'OPTIONS';
export type ContentType =
  | 'xml'
  | 'json'
  | 'urlencoded'
  | 'multipart'
  | 'formdata';
export type HeadersInit = [string, string][] | Record<string, string>;
export type Endpoint =
  | `${ContentType} ${Method} ${string}`
  | `${Method} ${string}`;

export type BodyInit =
  | ArrayBuffer
  | Blob
  | FormData
  | URLSearchParams
  | null
  | string;

export function createUrl(path: string, query: URLSearchParams) {
  const url = new URL(path, `local://`);
  url.search = query.toString();
  return url;
}

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
  serialize(): Serialized {
    const headers = new Headers({});
    for (const header of this.props.inputHeaders) {
      headers.set(header, this.input[header]);
    }

    const query = new URLSearchParams();
    for (const key of this.props.inputQuery) {
      const value = this.input[key];
      if (value !== undefined) {
        if (Array.isArray(value)) {
          for (const item of value) {
            query.append(key, String(item));
          }
        } else {
          query.set(key, String(value));
        }
      }
    }

    const params = this.props.inputParams.reduce<Record<string, any>>(
      (acc, key) => {
        acc[key] = this.input[key];
        return acc;
      },
      {},
    );

    return {
      body: this.getBody(),
      query,
      params,
      headers: this.getHeaders(),
    };
  }
}

interface Serialized {
  body: BodyInit | null;
  query: URLSearchParams;
  params: Record<string, any>;
  headers: Record<string, string>;
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
      body.set(prop, this.input[prop]);
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
  return new JsonSerializer(input, props).serialize();
}
export function urlencoded(input: Input, props: Props) {
  return new UrlencodedSerializer(input, props).serialize();
}
export function empty(input: Input, props: Props) {
  return new EmptySerializer(input, props).serialize();
}
export function formdata(input: Input, props: Props) {
  return new FormDataSerializer(input, props).serialize();
}

export function toRequest<T extends Endpoint>(
  endpoint: T,
  input: Serialized,
): RequestConfig {
  const [method, path] = endpoint.split(' ');
  const pathVariable = template(path, input.params);

  return {
    url: createUrl(pathVariable, input.query),
    init: {
      method: method,
      headers: new Headers(input.headers),
      body: method === 'GET' ? undefined : input.body,
    },
  };
}
