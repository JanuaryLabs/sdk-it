import { get } from 'lodash-es';
import type {
  OpenAPIObject,
  ReferenceObject,
  SchemaObject,
} from 'openapi3-ts/oas31';

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
export function followRef(spec: OpenAPIObject, ref: string): SchemaObject {
  const pathParts = cleanRef(ref).split('/');
  const entry = get(spec, pathParts) as SchemaObject | ReferenceObject;
  if (entry && '$ref' in entry) {
    return followRef(spec, entry.$ref);
  }
  return entry;
}
