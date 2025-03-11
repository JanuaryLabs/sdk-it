type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
type ContentType = 'xml' | 'json' | 'urlencoded' | 'multipart';
type Endpoint = `${ContentType} ${Method} ${string}` | `${Method} ${string}`;
export type BodyInit =
  | ArrayBuffer
  | AsyncIterable<Uint8Array>
  | Blob
  | FormData
  | Iterable<Uint8Array>
  | NodeJS.ArrayBufferView
  | URLSearchParams
  | null
  | string;

export function createUrl(base: string, path: string, query: URLSearchParams) {
  const url = new URL(path, base);
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

interface ToRequest {
  <T extends Endpoint>(
    endpoint: T,
    input: Record<string, any>,
    props: {
      inputHeaders: string[];
      inputQuery: string[];
      inputBody: string[];
      inputParams: string[];
    },
    defaults: {
      baseUrl: string;
      headers?: Partial<Record<string, string>>;
    },
  ): Request;
  urlencoded: <T extends Endpoint>(
    endpoint: T,
    input: Record<string, any>,
    props: {
      inputHeaders: string[];
      inputQuery: string[];
      inputBody: string[];
      inputParams: string[];
    },
    defaults: {
      baseUrl: string;
      headers?: Partial<Record<string, string>>;
    },
  ) => Request;
}

function _json(
  input: Record<string, any>,
  props: {
    inputHeaders: string[];
    inputQuery: string[];
    inputBody: string[];
    inputParams: string[];
  },
) {
  const headers = new Headers({});
  for (const header of props.inputHeaders) {
    headers.set(header, input[header]);
  }

  const body: Record<string, any> = {};
  for (const prop of props.inputBody) {
    body[prop] = input[prop];
  }

  const query = new URLSearchParams();
  for (const key of props.inputQuery) {
    const value = input[key];
    if (value !== undefined) {
      query.set(key, String(value));
    }
  }

  const params = props.inputParams.reduce<Record<string, any>>((acc, key) => {
    acc[key] = input[key];
    return acc;
  }, {});

  return {
    body: JSON.stringify(body),
    query,
    params,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  };
}

type Input = Record<string, any>;
type Props = {
  inputHeaders: string[];
  inputQuery: string[];
  inputBody: string[];
  inputParams: string[];
};

abstract class Serializer {
  constructor(
    protected input: Input,
    protected props: Props,
  ) {}
  abstract getBody(): BodyInit | null;
  abstract getHeaders(): Partial<Record<string, string>>;
  serialize(): Serialized {
    const headers = new Headers({});
    for (const header of this.props.inputHeaders) {
      headers.set(header, this.input[header]);
    }

    const query = new URLSearchParams();
    for (const key of this.props.inputQuery) {
      const value = this.input[key];
      if (value !== undefined) {
        query.set(key, String(value));
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
  headers: Partial<Record<string, string>>;
}

class JsonSerializer extends Serializer {
  getBody(): BodyInit | null {
    const body: Record<string, any> = {};
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
    return {};
  }
}

class NoBodySerializer extends Serializer {
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
    return {};
  }
}

export function json(input: Input, props: Props) {
  return new JsonSerializer(input, props).serialize();
}
export function urlencoded(input: Input, props: Props) {
  return new UrlencodedSerializer(input, props).serialize();
}
export function nobody(input: Input, props: Props) {
  return new NoBodySerializer(input, props).serialize();
}
export function formdata(input: Input, props: Props) {
  return new FormDataSerializer(input, props).serialize();
}

export function _urlencoded(
  input: Record<string, any>,
  props: {
    inputHeaders: string[];
    inputQuery: string[];
    inputBody: string[];
    inputParams: string[];
  },
) {
  const headers = new Headers({});
  for (const header of props.inputHeaders) {
    headers.set(header, input[header]);
  }

  const body = new URLSearchParams();
  for (const prop of props.inputBody) {
    body.set(prop, input[prop]);
  }

  const query = new URLSearchParams();
  for (const key of props.inputQuery) {
    const value = input[key];
    if (value !== undefined) {
      query.set(key, String(value));
    }
  }

  const params = props.inputParams.reduce<Record<string, any>>((acc, key) => {
    acc[key] = input[key];
    return acc;
  }, {});

  return {
    body,
    query,
    params,
    headers: {},
  };
}

export function toRequest<T extends Endpoint>(
  endpoint: T,
  input: Serialized,
  defaults: {
    baseUrl: string;
    headers?: Partial<Record<string, string>>;
  },
): Request {
  const [method, path] = endpoint.split(' ');

  const headers = new Headers(
    Object.entries({
      ...defaults?.headers,
      ...input.headers,
    }).filter(truthyEntry),
  );
  const pathVariable = template(path, input.params);

  const url = createUrl(defaults.baseUrl, pathVariable, input.query);
  return new Request(url, {
    method: method,
    headers: headers,
    body: method === 'GET' ? undefined : input.body,
  });
}

function truthyEntry(entry: [string, unknown]): entry is [string, string] {
  return entry[1] !== undefined;
}
