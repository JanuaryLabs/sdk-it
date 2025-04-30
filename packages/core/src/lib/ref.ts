import { get } from 'lodash-es';
import type {
  HeaderObject,
  OpenAPIObject,
  ParameterObject,
  ReferenceObject,
  RequestBodyObject,
  SchemaObject,
} from 'openapi3-ts/oas31';

import { isEmpty } from '..';

export function isRef(obj: any): obj is ReferenceObject {
  return obj && '$ref' in obj;
}
export function notRef(obj: any): obj is SchemaObject {
  return !isRef(obj);
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
  if (entry && '$ref' in entry) {
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
  const pathParts = cleanRef(ref).split('/');
  const entry = get(spec, pathParts) as T | ReferenceObject;
  let def: T;
  if (entry && '$ref' in entry) {
    def = followRef<T>(spec, entry.$ref!);
  } else {
    def = entry;
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
