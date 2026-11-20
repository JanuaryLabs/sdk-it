import { type OpenAPIDocument, isRef, pointerTokens } from '@sdk-it/core';

import type { Documents } from '../documents/documents.js';
import {
  type ReferenceLocation,
  UnresolvedReferenceError,
} from '../documents/errors.js';
import { Reference } from '../documents/reference.js';
import { isJsonObject } from '../json.js';
import { availableName } from './available-name.js';
import {
  type NodeKind,
  PathItem,
  type Slot,
  componentKinds,
  entries,
} from './node-kinds.js';

/**
 * Hoists each external `$ref` target into the components section its
 * position calls for and rewrites the reference to it, resolving relative
 * references against the document that holds them.
 */
export class ExternalRefBundler {
  readonly #spec: OpenAPIDocument;
  readonly #documents: Documents;
  readonly #root: string | undefined;
  readonly #hoisted = new Map<string, string>();
  readonly #inlining = new Set<string>();

  constructor(spec: OpenAPIDocument, documents: Documents) {
    this.#spec = spec;
    this.#documents = documents;
    this.#root = spec.$self;
  }

  async bundle() {
    await this.#visitSlots(entries(this.#spec.paths, PathItem), {
      document: this.#root,
      tokens: ['paths'],
    });
    await this.#visitSlots(entries(this.#spec.webhooks, PathItem), {
      document: this.#root,
      tokens: ['webhooks'],
    });
    const components: unknown = this.#spec.components;
    if (isJsonObject(components)) {
      for (const [section, kind] of Object.entries(componentKinds)) {
        await this.#visitSlots(entries(components[section], kind), {
          document: this.#root,
          tokens: ['components', section],
        });
      }
    }
  }

  async #visitSlots(slots: Iterable<Slot>, at: ReferenceLocation) {
    for (const { holder, key, kind, path } of slots) {
      const child: unknown = Reflect.get(holder, key);
      Reflect.set(
        holder,
        key,
        await this.#visit(child, kind, {
          document: at.document,
          tokens: [...at.tokens, ...path],
        }),
      );
    }
  }

  async #visit(node: unknown, kind: NodeKind, at: ReferenceLocation) {
    if (!isJsonObject(node)) {
      return node;
    }
    if (isRef(node)) {
      return this.#visitRef(node, kind, at);
    }
    await this.#visitSlots(kind.slots(node), at);
    return node;
  }

  async #visitRef(
    node: { $ref: string },
    kind: NodeKind,
    at: ReferenceLocation,
  ): Promise<unknown> {
    const reference = new Reference(node.$ref);
    if (reference.sameDocument && at.document === this.#root) {
      return node;
    }
    let url: URL;
    try {
      url = reference.documentIn(at.document);
    } catch (error) {
      throw new UnresolvedReferenceError(node.$ref, at, { cause: error });
    }
    if (url.href === this.#root) {
      node.$ref = `#${reference.fragment}`;
      return node;
    }

    const key = `${url.href}#${reference.fragment}`;
    const { section } = kind;
    const hoisted = this.#hoisted.get(key);
    if (section && hoisted) {
      node.$ref = `#/components/${section}/${hoisted}`;
      return node;
    }
    if (!section && this.#inlining.has(key)) {
      throw new UnresolvedReferenceError(node.$ref, at, {
        cause: new Error('the reference is circular'),
      });
    }

    let target: unknown;
    try {
      target = structuredClone(reference.read(await this.#documents.load(url)));
    } catch (error) {
      throw new UnresolvedReferenceError(node.$ref, at, { cause: error });
    }
    const targetAt = {
      document: url.href,
      tokens: pointerTokens(reference.fragment),
    };

    if (!section) {
      this.#inlining.add(key);
      const inlined = await this.#visit(target, kind, targetAt);
      this.#inlining.delete(key);
      return inlined;
    }

    const components: Record<string, unknown> = (this.#spec.components ??= {});
    const registry = (components[section] ??= {});
    if (!isJsonObject(registry)) {
      throw new UnresolvedReferenceError(node.$ref, at, {
        cause: new Error(`components.${section} is not an object`),
      });
    }
    const name = availableName(registry, componentName(reference, section));
    registry[name] = target;
    this.#hoisted.set(key, name);
    registry[name] = await this.#visit(target, kind, targetAt);
    node.$ref = `#/components/${section}/${name}`;
    return node;
  }
}

function componentName(reference: Reference, section: string) {
  const candidate =
    lastSegment(reference.fragment) ??
    lastSegment(reference.location.split('?')[0])?.replace(
      /\.(json|ya?ml)$/i,
      '',
    );
  const sanitized = (candidate ?? '').replace(/[^a-zA-Z0-9._-]/g, '');
  return sanitized || `external-${section}`;
}

function lastSegment(value: string) {
  return value.split('/').filter(Boolean).at(-1);
}
