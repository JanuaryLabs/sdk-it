import { resolve } from 'node:path';

import { exist } from '@sdk-it/core/file-system.js';

export async function findSpecFile() {
  const commonNames = [
    'openapi.json',
    'openapi.yaml',
    'openapi.yml',
    'swagger.json',
    'swagger.yaml',
    'swagger.yml',
    'api.json',
    'api.yaml',
    'api.yml',
    'spec.json',
    'spec.yaml',
    'spec.yml',
    'schema.json',
    'schema.yaml',
    'schema.yml',
  ];

  for (const name of commonNames) {
    if (await exist(resolve(process.cwd(), name))) {
      return `./${name}`;
    }
  }
  return undefined;
}
