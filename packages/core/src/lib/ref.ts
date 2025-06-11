import { get } from 'lodash-es';
import type {
  HeaderObject,
  OpenAPIObject,
  ParameterObject,
  ReferenceObject,
  RequestBodyObject,
  SchemaObject,
} from 'openapi3-ts/oas31';

import { isEmpty } from './utils.js';

export function isRef(obj: any): obj is ReferenceObject {
  return obj && '$ref' in obj;
}
export function notRef(obj: any): obj is SchemaObject {
  return !isRef(obj);
}

export function cleanRef(ref: string) {
  return ref.replace(/^#\//, '');
}

export function parseRef(ref:string) {
  const parts = ref.split('/');
  const names: string[] = [];
  const [model] = parts.splice(-1);
  names.push(model);
  while (parts.lastIndexOf('properties') !== -1) {
    parts.splice(parts.lastIndexOf('properties'), 1);
    const [model] = parts.splice(-1);
    names.push(model);
  }
  const [namespace] = parts.splice(-1);
  return {
    model: names.reverse().join(' '),
    namespace,
    path: cleanRef(parts.join('/')),
  };
}

export function resolveRef<
  T extends
    | SchemaObject
    | HeaderObject
    | ParameterObject
    | ReferenceObject
    | RequestBodyObject = SchemaObject,
>(spec: OpenAPIObject, maybeRef: SchemaObject | ReferenceObject): T {
  if (isRef(maybeRef)) {
    return followRef<T>(spec, maybeRef.$ref!);
  }
  return maybeRef as T;
}
export function followRef<
  T extends
    | SchemaObject
    | HeaderObject
    | ParameterObject
    | ReferenceObject
    | RequestBodyObject = SchemaObject,
>(spec: OpenAPIObject, ref: string): T {
  const pathParts = cleanRef(ref).split('/');
  const entry = get(spec, pathParts) as T | ReferenceObject;
  if (isRef(entry)) {
    return followRef<T>(spec, entry.$ref!);
  }
  return entry;
}
export function distillRef<
  T extends
    | SchemaObject
    | HeaderObject
    | ParameterObject
    | ReferenceObject
    | RequestBodyObject = SchemaObject,
>(spec: OpenAPIObject, ref: string): T {
  const def = followRef<T>(spec, ref);
  if (!def) {
    return def;
  }

  if ('properties' in def) {
    def.properties ??= {};
    for (const key in def.properties) {
      const prop = def.properties[key];
      if (isRef(prop)) {
        def.properties[key] = distillRef(spec, prop.$ref);
      }
    }
  }
  if ('items' in def) {
    if (isRef(def.items)) {
      def.items = distillRef<SchemaObject>(spec, def.items.$ref);
    }
  }
  if ('allOf' in def && !isEmpty(def.allOf)) {
    def.allOf = def.allOf.map((item) => {
      if (isRef(item)) {
        return distillRef<SchemaObject>(spec, item.$ref);
      }
      return item;
    });
  }
  if ('oneOf' in def && !isEmpty(def.oneOf)) {
    def.oneOf = def.oneOf.map((item) => {
      if (isRef(item)) {
        return distillRef<SchemaObject>(spec, item.$ref);
      }
      return item;
    });
  }
  if ('anyOf' in def && !isEmpty(def.anyOf)) {
    def.anyOf = def.anyOf.map((item) => {
      if (isRef(item)) {
        return distillRef<SchemaObject>(spec, item.$ref);
      }
      return item;
    });
  }

  return def;
}
