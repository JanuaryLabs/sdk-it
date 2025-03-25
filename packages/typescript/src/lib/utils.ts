import { get } from 'lodash-es';
import type {
  ComponentsObject,
  OpenAPIObject,
  ReferenceObject,
  SchemaObject,
  SecurityRequirementObject,
} from 'openapi3-ts/oas31';

import { removeDuplicates } from '@sdk-it/core';

import { type Options } from './sdk.ts';

export function isRef(obj: any): obj is ReferenceObject {
  return obj && '$ref' in obj;
}

export function cleanRef(ref: string) {
  return ref.replace(/^#\//, '');
}

export function parseRef(ref: string) {
  const parts = ref.split('/');
  const [model] = parts.splice(-1);
  const [namespace] = parts.splice(-1);
  return {
    model,
    namespace,
    path: cleanRef(parts.join('/')),
  };
}
export function followRef(spec: OpenAPIObject, ref: string): SchemaObject {
  const pathParts = cleanRef(ref).split('/');
  const entry = get(spec, pathParts) as SchemaObject | ReferenceObject;
  if (entry && '$ref' in entry) {
    return followRef(spec, entry.$ref);
  }
  return entry;
}
export function securityToOptions(
  security: SecurityRequirementObject[],
  securitySchemes: ComponentsObject['securitySchemes'],
  staticIn?: string,
) {
  securitySchemes ??= {};
  const options: Options = {};
  for (const it of security) {
    const [name] = Object.keys(it);
    if (!name) {
      // this means the operation doesn't necessarily require security
      continue;
    }
    const schema = securitySchemes[name];
    if (isRef(schema)) {
      throw new Error(`Ref security schemas are not supported`);
    }
    if (schema.type === 'http') {
      options['authorization'] = {
        in: staticIn ?? 'header',
        schema:
          'z.string().optional().transform((val) => (val ? `Bearer ${val}` : undefined))',
        optionName: 'token',
      };
      continue;
    }
    if (schema.type === 'apiKey') {
      if (!schema.in) {
        throw new Error(`apiKey security schema must have an "in" field`);
      }
      if (!schema.name) {
        throw new Error(`apiKey security schema must have a "name" field`);
      }
      options[schema.name] = {
        in: staticIn ?? schema.in,
        schema: 'z.string().optional()',
      };
      continue;
    }
  }
  return options;
}

export function mergeImports(...imports: Import[]) {
  const merged: Record<string, Import> = {};

  for (const it of imports) {
    merged[it.moduleSpecifier] = merged[it.moduleSpecifier] ?? {
      moduleSpecifier: it.moduleSpecifier,
      defaultImport: it.defaultImport,
      namespaceImport: it.namespaceImport,
      namedImports: [],
    };
    for (const named of it.namedImports) {
      if (
        !merged[it.moduleSpecifier].namedImports.some(
          (x) => x.name === named.name,
        )
      ) {
        merged[it.moduleSpecifier].namedImports.push(named);
      }
    }
  }

  return Object.values(merged);
}

export interface Import {
  isTypeOnly: boolean;
  moduleSpecifier: string;
  defaultImport: string | undefined;
  namedImports: NamedImport[];
  namespaceImport: string | undefined;
}
export interface NamedImport {
  name: string;
  alias?: string;
  isTypeOnly: boolean;
}

export function importsToString(...imports: Import[]) {
  return imports.map((it) => {
    if (it.defaultImport) {
      return `import ${it.defaultImport} from '${it.moduleSpecifier}'`;
    }
    if (it.namespaceImport) {
      return `import * as ${it.namespaceImport} from '${it.moduleSpecifier}'`;
    }
    if (it.namedImports) {
      return `import {${removeDuplicates(it.namedImports, (it) => it.name)
        .map((n) => `${n.isTypeOnly ? 'type' : ''} ${n.name}`)
        .join(', ')}} from '${it.moduleSpecifier}'`;
    }
    throw new Error(`Invalid import ${JSON.stringify(it)}`);
  });
}

export function exclude<T>(list: T[], exclude: T[]): T[] {
  return list.filter((it) => !exclude.includes(it));
}

export function useImports(content: string, ...imports: Import[]) {
  const output: string[] = [];
  for (const it of mergeImports(...imports)) {
    const singleImport = it.defaultImport ?? it.namespaceImport;
    if (singleImport && content.includes(singleImport)) {
      output.push(importsToString(it).join('\n'));
    } else if (it.namedImports.length) {
      for (const namedImport of it.namedImports) {
        if (content.includes(namedImport.name)) {
          output.push(importsToString(it).join('\n'));
        }
      }
    }
  }
  return output;
}

export type MakeImportFn = (moduleSpecifier: string) => string;
