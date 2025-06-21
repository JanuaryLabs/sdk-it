import type * as models from '../index.ts';

export type PostPlayground = {
  url: 'https://raw.githubusercontent.com/openai/openai-openapi/refs/heads/master/openapi.yaml';
  title: string;
  name: string;
  clientName: string;
};

export type PostPlayground400 = models.ValidationError;
