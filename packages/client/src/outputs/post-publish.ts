import type * as models from '../index.ts';

export type PostPublish = {
  message: 'SDK published successfully';
  specUrl: string;
};

export type PostPublish400 = models.ValidationError;
