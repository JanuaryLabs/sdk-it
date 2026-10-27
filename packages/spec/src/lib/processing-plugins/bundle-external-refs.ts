import { type OpenAPIDocument, isRef } from '@sdk-it/core';

import {
  type Documents,
  availableName,
  documentUrl,
  loadDocument,
  readPointer,
  splitFragment,
} from '../external-documents.js';
import type { ProcessingPlugin } from '../processing.js';

type NodeType =
  | 'Schema'
  | 'Parameter'
  | 'Header'
  | 'RequestBody'
  | 'Response'
  | 'MediaType'
  | 'Encoding'
  | 'Example'
  | 'Link'
  | 'Callback'
  | 'PathItem'
  | 'Operation'
  | 'SecurityScheme';

type Node = Record<string, unknown>;

// The components section an external target of each type is hoisted into,
// as Redocly's bundler and swagger-parser do. A type without a section (a
// path item) is inlined where it is referenced.
const sections: Partial<Record<NodeType, string>> = {
  Schema: 'schemas',
  Parameter: 'parameters',
  Header: 'headers',
  RequestBody: 'requestBodies',
  Response: 'responses',
  Example: 'examples',
  Link: 'links',
  Callback: 'callbacks',
  SecurityScheme: 'securitySchemes',
};

const componentTypes: Record<string, NodeType> = {
  schemas: 'Schema',
  parameters: 'Parameter',
  headers: 'Header',
  requestBodies: 'RequestBody',
  responses: 'Response',
  examples: 'Example',
  links: 'Link',
  callbacks: 'Callback',
  securitySchemes: 'SecurityScheme',
  pathItems: 'PathItem',
};

const operationMethods = [
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
];

// Keys whose values are data, not schemas, so a `$ref` inside them is content.
const schemaDataKeys = new Set([
  'example',
  'examples',
  'default',
  'const',
  'enum',
]);

interface Bundle {
  spec: OpenAPIDocument;
  root: string | undefined;
  documents: Documents;
  hoisted: Map<string, string>;
  inlining: Set<string>;
}

/**
 * The IR holds only local `#/…` references; every later plugin relies on it.
 * External references are brought in before anything else runs. A spec from
 * `loadSpec` is already bundled, so this only acts on a spec given as an object.
 */
export function bundleExternalRefs(): ProcessingPlugin {
  return {
    name: 'bundle-external-refs',
    process({ spec }) {
      return bundleDocument(spec, new Map());
    },
  };
}

/**
 * Hoists each external `$ref` target into the components section its
 * position calls for and rewrites the reference to it, resolving relative
 * references against the document that holds them. Every document read is
 * recorded in `documents`.
 */
export async function bundleDocument(
  spec: OpenAPIDocument,
  documents: Documents,
) {
  const bundle: Bundle = {
    spec,
    root: spec.$self,
    documents,
    hoisted: new Map(),
    inlining: new Set(),
  };
  await visitMap(spec.paths, 'PathItem', bundle.root, bundle);
  await visitMap(spec.webhooks, 'PathItem', bundle.root, bundle);
  const components = spec.components as Record<string, Node | undefined>;
  for (const [section, type] of Object.entries(componentTypes)) {
    await visitMap(components?.[section], type, bundle.root, bundle);
  }
}

async function visit(
  node: unknown,
  type: NodeType,
  base: string | undefined,
  bundle: Bundle,
): Promise<unknown> {
  if (node === null || typeof node !== 'object') {
    return node;
  }
  if (isRef(node)) {
    return visitRef(node, type, base, bundle);
  }
  await visitChildren(node as Node, type, base, bundle);
  return node;
}

async function visitRef(
  node: { $ref: string },
  type: NodeType,
  base: string | undefined,
  bundle: Bundle,
): Promise<unknown> {
  const [location, fragment = ''] = splitFragment(node.$ref);
  if (!location && base === bundle.root) {
    return node;
  }
  let url: URL;
  try {
    url = documentUrl(location, base);
  } catch (error) {
    throw unresolved(node.$ref, base, error);
  }
  if (url.href === bundle.root) {
    node.$ref = `#${fragment}`;
    return node;
  }

  const key = `${url.href}#${fragment}`;
  const section = sections[type];
  const hoisted = bundle.hoisted.get(key);
  if (section && hoisted) {
    node.$ref = `#/components/${section}/${hoisted}`;
    return node;
  }
  if (!section && bundle.inlining.has(key)) {
    throw unresolved(node.$ref, base, new Error('the reference is circular'));
  }

  let target: unknown;
  try {
    const document = await loadDocument(url, bundle.documents);
    target = structuredClone(
      fragment ? readPointer(document, fragment) : document,
    );
  } catch (error) {
    throw unresolved(node.$ref, base, error);
  }

  if (!section) {
    bundle.inlining.add(key);
    const inlined = await visit(target, type, url.href, bundle);
    bundle.inlining.delete(key);
    return inlined;
  }

  const components = (bundle.spec.components ??= {}) as Record<
    string,
    Node | undefined
  >;
  const registry = (components[section] ??= {});
  const name = availableName(
    registry,
    componentName(location, fragment, section),
  );
  registry[name] = target;
  bundle.hoisted.set(key, name);
  registry[name] = await visit(target, type, url.href, bundle);
  node.$ref = `#/components/${section}/${name}`;
  return node;
}

async function visitChildren(
  node: Node,
  type: NodeType,
  base: string | undefined,
  bundle: Bundle,
) {
  switch (type) {
    case 'Schema':
      return visitSchema(node, base, bundle);
    case 'PathItem':
      await visitList(node, 'parameters', 'Parameter', base, bundle);
      for (const method of operationMethods) {
        await visitKey(node, method, 'Operation', base, bundle);
      }
      return;
    case 'Operation':
      await visitList(node, 'parameters', 'Parameter', base, bundle);
      await visitKey(node, 'requestBody', 'RequestBody', base, bundle);
      await visitMap(node['responses'], 'Response', base, bundle);
      await visitMap(node['callbacks'], 'Callback', base, bundle);
      return;
    case 'Callback':
      return visitMap(node, 'PathItem', base, bundle);
    case 'Parameter':
    case 'Header':
      await visitKey(node, 'schema', 'Schema', base, bundle);
      await visitMap(node['content'], 'MediaType', base, bundle);
      await visitMap(node['examples'], 'Example', base, bundle);
      return;
    case 'RequestBody':
      return visitMap(node['content'], 'MediaType', base, bundle);
    case 'Response':
      await visitMap(node['headers'], 'Header', base, bundle);
      await visitMap(node['content'], 'MediaType', base, bundle);
      await visitMap(node['links'], 'Link', base, bundle);
      return;
    case 'MediaType':
      await visitKey(node, 'schema', 'Schema', base, bundle);
      await visitMap(node['examples'], 'Example', base, bundle);
      await visitMap(node['encoding'], 'Encoding', base, bundle);
      return;
    case 'Encoding':
      return visitMap(node['headers'], 'Header', base, bundle);
    case 'Example':
    case 'Link':
    case 'SecurityScheme':
      return;
  }
}

async function visitSchema(
  node: Node,
  base: string | undefined,
  bundle: Bundle,
) {
  for (const [key, value] of Object.entries(node)) {
    if (
      schemaDataKeys.has(key) ||
      value === null ||
      typeof value !== 'object'
    ) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const [index, item] of value.entries()) {
        value[index] = await visit(item, 'Schema', base, bundle);
      }
    } else {
      node[key] = await visit(value, 'Schema', base, bundle);
    }
  }
}

async function visitKey(
  node: Node,
  key: string,
  type: NodeType,
  base: string | undefined,
  bundle: Bundle,
) {
  if (node[key] !== undefined) {
    node[key] = await visit(node[key], type, base, bundle);
  }
}

async function visitList(
  node: Node,
  key: string,
  type: NodeType,
  base: string | undefined,
  bundle: Bundle,
) {
  const list = node[key];
  if (Array.isArray(list)) {
    for (const [index, item] of list.entries()) {
      list[index] = await visit(item, type, base, bundle);
    }
  }
}

async function visitMap(
  map: unknown,
  type: NodeType,
  base: string | undefined,
  bundle: Bundle,
) {
  if (map === null || typeof map !== 'object') {
    return;
  }
  for (const key of Object.keys(map)) {
    await visitKey(map as Node, key, type, base, bundle);
  }
}

function componentName(location: string, fragment: string, section: string) {
  const candidate =
    lastSegment(fragment) ??
    lastSegment(location.split('?')[0])?.replace(/\.(json|ya?ml)$/i, '');
  const sanitized = (candidate ?? '').replace(/[^a-zA-Z0-9._-]/g, '');
  return sanitized || `external-${section}`;
}

function lastSegment(value: string) {
  return value.split('/').filter(Boolean).at(-1);
}

function unresolved(ref: string, base: string | undefined, error: unknown) {
  return new Error(
    `Could not resolve $ref ${ref} from ${base ?? 'a document without $self'}: ${error instanceof Error ? error.message : String(error)}`,
  );
}
