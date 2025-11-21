import type * as models from '../index.ts';

export type GetOperations = {
  operations: string[];
  pagination: {
    hasNextPage: boolean;
    hasPreviousPage: boolean;
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
};

export type GetOperations400 = models.ValidationError;

export type GetOperations415 =
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
