import { isJsonObject } from '../json.js';

type Node = Record<string, unknown>;

/** The place `holder[key]` where a child of `kind` sits, `path` tokens below the node whose slot it is. */
export interface Slot {
  holder: Node | unknown[];
  key: string | number;
  kind: NodeKind;
  path: readonly string[];
}

/**
 * An OpenAPI object type: the components section an external target of it is
 * hoisted into, as Redocly's bundler and swagger-parser do (none for a type
 * that is inlined where it is referenced, such as a path item), and the slots
 * its children sit in.
 */
export interface NodeKind {
  readonly section: string | undefined;
  slots(node: Node): Iterable<Slot>;
}

function* field(node: Node, key: string, kind: NodeKind): Iterable<Slot> {
  if (node[key] !== undefined) {
    yield { holder: node, key, kind, path: [key] };
  }
}

function* list(node: Node, key: string, kind: NodeKind): Iterable<Slot> {
  const items = node[key];
  if (Array.isArray(items)) {
    for (const index of items.keys()) {
      yield { holder: items, key: index, kind, path: [key, String(index)] };
    }
  }
}

/** A slot for each member of `map`. */
export function* entries(map: unknown, kind: NodeKind): Iterable<Slot> {
  if (isJsonObject(map)) {
    for (const key of Object.keys(map)) {
      yield* field(map, key, kind);
    }
  }
}

/** A slot for each member of the map at `node[key]`. */
function* members(node: Node, key: string, kind: NodeKind): Iterable<Slot> {
  for (const slot of entries(node[key], kind)) {
    yield { ...slot, path: [key, ...slot.path] };
  }
}

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

const none: NodeKind['slots'] = function* () {};

export const Schema: NodeKind = {
  section: 'schemas',
  *slots(node) {
    for (const [key, value] of Object.entries(node)) {
      if (
        schemaDataKeys.has(key) ||
        value === null ||
        typeof value !== 'object'
      ) {
        continue;
      }
      if (Array.isArray(value)) {
        yield* list(node, key, Schema);
      } else {
        yield* field(node, key, Schema);
      }
    }
  },
};

export const Example: NodeKind = { section: 'examples', slots: none };
export const Link: NodeKind = { section: 'links', slots: none };
export const SecurityScheme: NodeKind = {
  section: 'securitySchemes',
  slots: none,
};

export const Header: NodeKind = {
  section: 'headers',
  *slots(node) {
    yield* field(node, 'schema', Schema);
    yield* members(node, 'content', MediaType);
    yield* members(node, 'examples', Example);
  },
};

export const Parameter: NodeKind = {
  section: 'parameters',
  slots: Header.slots,
};

export const Encoding: NodeKind = {
  section: undefined,
  *slots(node) {
    yield* members(node, 'headers', Header);
  },
};

export const MediaType: NodeKind = {
  section: undefined,
  *slots(node) {
    yield* field(node, 'schema', Schema);
    yield* members(node, 'examples', Example);
    yield* members(node, 'encoding', Encoding);
  },
};

export const RequestBody: NodeKind = {
  section: 'requestBodies',
  *slots(node) {
    yield* members(node, 'content', MediaType);
  },
};

export const Response: NodeKind = {
  section: 'responses',
  *slots(node) {
    yield* members(node, 'headers', Header);
    yield* members(node, 'content', MediaType);
    yield* members(node, 'links', Link);
  },
};

export const Operation: NodeKind = {
  section: undefined,
  *slots(node) {
    yield* list(node, 'parameters', Parameter);
    yield* field(node, 'requestBody', RequestBody);
    yield* members(node, 'responses', Response);
    yield* members(node, 'callbacks', Callback);
  },
};

export const PathItem: NodeKind = {
  section: undefined,
  *slots(node) {
    yield* list(node, 'parameters', Parameter);
    for (const method of operationMethods) {
      yield* field(node, method, Operation);
    }
  },
};

export const Callback: NodeKind = {
  section: 'callbacks',
  *slots(node) {
    yield* entries(node, PathItem);
  },
};

/** The kind of each components section, in the order the bundler visits them. */
export const componentKinds: Record<string, NodeKind> = {
  schemas: Schema,
  parameters: Parameter,
  headers: Header,
  requestBodies: RequestBody,
  responses: Response,
  examples: Example,
  links: Link,
  callbacks: Callback,
  securitySchemes: SecurityScheme,
  pathItems: PathItem,
};
