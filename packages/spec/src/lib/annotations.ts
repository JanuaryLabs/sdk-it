import type { ReferenceObject, SchemaObject } from 'openapi3-ts/oas31';

import { isRef, resolveRef, tapRef } from '@sdk-it/core';

import type { IR } from './types.js';

type Schema = SchemaObject | ReferenceObject;

/** The JSON Schema 2020-12 and OpenAPI 3.1/3.2 annotations of a schema, read beside each `$ref` and through to its target. */
export interface Annotations {
  title?: string;
  description?: string;
  default?: unknown;
  deprecated: boolean;
  readOnly: boolean;
  writeOnly: boolean;
  examples: unknown[];
}

/** The schema, then each schema its `$ref` chain reaches, nearest first. */
function layersOf(schema: Schema, spec: IR): SchemaObject[] {
  const layers: SchemaObject[] = [];
  const followed = new Set<string>();
  let layer: Schema = schema;
  while (isRef(layer)) {
    if (followed.has(layer.$ref)) {
      throw new Error(
        `Circular $ref ${[...followed, layer.$ref].join(' -> ')}: each reference points at the next, so none resolves to a value.`,
      );
    }
    followed.add(layer.$ref);
    const { $ref: _, ...siblings } = layer;
    layers.push(siblings);
    layer = tapRef<Schema>(spec, layer);
  }
  layers.push(layer);
  return layers;
}

/**
 * Keywords beside a `$ref` evaluate with its target (JSON Schema Core §8.2.3.1):
 * the nearest `title`, `description` and `default` win, a flag is true when any
 * occurrence is (Validation §9.3, §9.4), and `examples` collects every occurrence
 * (§9.5), reading OpenAPI's deprecated `example` as one example.
 */
export function annotationsOf(schema: Schema, spec: IR): Annotations {
  const layers = layersOf(schema, spec);
  const nearest = (keyword: 'title' | 'description' | 'default') =>
    layers.find((layer) => Object.hasOwn(layer, keyword));
  const titleLayer = nearest('title');
  const descriptionLayer = nearest('description');
  const defaultLayer = nearest('default');
  return {
    ...(titleLayer && { title: titleLayer.title }),
    ...(descriptionLayer && { description: descriptionLayer.description }),
    ...(defaultLayer && { default: defaultLayer.default }),
    deprecated: layers.some((layer) => layer.deprecated === true),
    readOnly: layers.some((layer) => layer.readOnly === true),
    writeOnly: layers.some((layer) => layer.writeOnly === true),
    examples: layers.flatMap((layer) => [
      ...(layer.examples ?? []),
      ...(Object.hasOwn(layer, 'example') ? [layer.example] : []),
    ]),
  };
}

/** The object's `required` names that a request (no readOnly) or a response (no writeOnly) must carry. */
export function requiredOn(
  schema: Schema,
  spec: IR,
  side: 'request' | 'response',
): string[] {
  const object = resolveRef<SchemaObject>(spec, schema);
  const flag = side === 'request' ? 'readOnly' : 'writeOnly';
  return (object.required ?? []).filter((name) => {
    const property = object.properties?.[name];
    return !(property && annotationsOf(property, spec)[flag]);
  });
}
