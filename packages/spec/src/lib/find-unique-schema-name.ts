import type { OpenAPIObject } from 'openapi3-ts/oas31';

import { joinSkipDigits, pascalcase } from '@sdk-it/core';

const reservedNames = new Set(['Function', 'Error']);

export function findUniqueSchemaName(
  spec: OpenAPIObject,
  initialName: string,
  potentialSuffixList: string[],
  fallback?: string,
) {
  spec.components ??= {};
  spec.components.schemas ??= {};
  let name = pascalcase(initialName);
  while (spec.components.schemas[name] || reservedNames.has(name)) {
    const suffix = potentialSuffixList.shift();
    name = pascalcase(joinSkipDigits([name, suffix || ''], ' '));
  }
  return initialName === name ? (fallback ?? name) : name;
}
