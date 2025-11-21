import type * as models from '../index.ts';

export type PostGenerate = string;

export type PostGenerate400 = models.ValidationError;

export type PostGenerate415 =
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
