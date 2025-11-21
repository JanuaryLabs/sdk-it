import type * as models from '../index.ts';

export type PostAugment = { [key: string]: any };

export type PostAugment400 = models.ValidationError;

export type PostAugment415 =
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
