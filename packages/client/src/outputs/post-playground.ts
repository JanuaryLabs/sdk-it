import type * as models from '../index.ts';

export type PostPlayground = {
  clientName: string;
  name: string;
  title: string;
  url: 'https://raw.githubusercontent.com/openai/openai-openapi/refs/heads/master/openapi.yaml';
};

export type PostPlayground400 = models.ValidationError;

export type PostPlayground415 =
  | {
      cause: {
        code: 'api/unsupported-media-type';
        details: 'GET requests cannot have a content type header';
      };
      message: 'Unsupported Media Type';
    }
  | {
      cause: {
        code: 'api/unsupported-media-type';
        details: 'Missing content type header';
      };
      message: 'Unsupported Media Type';
    }
  | {
      cause: { code: 'api/unsupported-media-type'; details: string };
      message: 'Unsupported Media Type';
    };
