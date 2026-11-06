import runtime, { type RuntimeBinding } from 'runtime-module';

import type { References } from './references.ts';
import { runtimeRootExports } from './root-exports.ts';

/**
 * The names a one-module SDK uses: spec names as declared, and runtime names
 * and globals as marks that `assembleModule` resolves once it knows which spec
 * names take a runtime name or shadow a global; a located name is marked with
 * its location (`@` and the location JSON, then the name). Generated code never
 * contains a NUL character (JSON.stringify escapes it), so a mark cannot collide.
 */
export const moduleReferences: References = {
  model: (typeName) => typeName,
  input: (_group, schemaName) => schemaName,
  status: (className) => `\0${className}\0`,
  runtime: (name) => `\0${name}\0`,
  global: (name) => `\0globalThis.${name}\0`,
  located: (text, location) => `\0@${JSON.stringify(location)}\0${text}\0`,
};

/**
 * A range of a one-module SDK's text (UTF-16 offsets, `end` exclusive) that
 * names what the OpenAPI document declares at `location` (RFC 6901 reference
 * tokens, unescaped): an endpoint key, a model, create<Name>, the default
 * instance.
 */
export interface ModuleSpan {
  start: number;
  end: number;
  location: readonly string[];
}

export interface ModuleParts {
  /** Shared zod schemas by name, each after the ones it uses. */
  commonZod: Map<string, string>;
  inputs: { name: string; zod: string }[];
  /** `location` is where the document declares the model, when it does. */
  models: {
    typeName: string;
    doc: string;
    type: string;
    location: readonly string[] | undefined;
  }[];
  /** Endpoint entries (`"GET /pets": {…}`) of the table the client reads as `__routes`. */
  endpoints: string[];
  /** The client declarations over `__routes`. */
  client: string;
  /** The names `client` declares. */
  clientNames: readonly string[];
  /** Runtime functions and types the SDK root exports besides the response and parser ones. */
  runtimeExports: readonly string[];
  runtimeTypeExports: readonly string[];
}

/**
 * The SDK as one module text: the runtime, then the spec's shared schemas,
 * inputs, models, endpoint table and client, each after what it uses.
 * Runtime and spec share one scope, and spec names win: a runtime binding a
 * spec name takes is renamed `__<name>`, and a global a spec name shadows is
 * read as `globalThis.<name>`.
 */
export function assembleModule(parts: ModuleParts): {
  text: string;
  spans: ModuleSpan[];
} {
  const specNames = new Set([
    ...parts.commonZod.keys(),
    ...parts.inputs.map(({ name }) => name),
    ...parts.models.map(({ typeName }) => typeName),
    ...parts.clientNames,
    '__routes',
  ]);
  const names = runtimeNames(specNames);
  const declaredName = new Map(
    runtime.bindings.flatMap((binding, index) =>
      binding.kind === 'declared'
        ? [[binding.name, names[index]] as const]
        : [],
    ),
  );
  const zodName = names.find(
    (_, index) =>
      runtime.bindings[index].kind === 'external' &&
      runtime.bindings[index].name === 'z',
  );
  if (zodName !== 'z') {
    throw new TypeError(
      'The SDK declares z, the name generated code reads zod by; rename the client',
    );
  }
  for (const name of [
    ...runtimeRootExports.map((binding) => binding.name),
    ...parts.runtimeExports,
    ...parts.runtimeTypeExports,
  ]) {
    if (declaredName.get(name) !== name) {
      throw new TypeError(
        `The SDK declares ${name}, which the SDK root exports from the runtime; rename the client or the schema`,
      );
    }
  }
  const nameOf = (name: string, global: boolean) => {
    if (global) {
      return specNames.has(name) ? `globalThis.${name}` : name;
    }
    const finalName = declaredName.get(name);
    if (finalName === undefined) {
      throw new TypeError(`The runtime declares no ${name}`);
    }
    return finalName;
  };

  const values = runtimeRootExports
    .filter(({ type }) => !type)
    .map(({ name }) => name);
  const types = runtimeRootExports
    .filter(({ type }) => type)
    .map(({ name }) => name);
  const pieces = [
    externalImports(names),
    runtimeText(names, specNames),
    ...[...parts.commonZod].map(
      ([name, schema]) => `const ${name} = ${schema};`,
    ),
    ...parts.inputs.map(({ name, zod }) => `export const ${name} = ${zod};`),
    ...parts.models.map(
      ({ typeName, doc, type, location }) =>
        `${doc}export type ${location ? moduleReferences.located(typeName, location) : typeName} = ${type};`,
    ),
    `const __routes = {\n${parts.endpoints.join(',\n')}\n};`,
    parts.client,
    `export { ${[...values, ...parts.runtimeExports].join(', ')} };`,
    `export type { ${[...types, ...parts.runtimeTypeExports].join(', ')} };`,
  ];

  let text = '';
  const spans: ModuleSpan[] = [];
  for (const [index, piece] of pieces.entries()) {
    if (index > 0) text += '\n';
    let cursor = 0;
    for (const mark of piece.matchAll(marks)) {
      text += piece.slice(cursor, mark.index);
      const [, location, located, global, name] = mark;
      if (location !== undefined) {
        const start = text.length;
        text += located;
        spans.push({ start, end: text.length, location: JSON.parse(location) });
      } else {
        text += nameOf(name, global !== undefined);
      }
      cursor = mark.index + mark[0].length;
    }
    text += piece.slice(cursor);
  }
  return { text, spans };
}

/** A located name (location JSON, then text) or a runtime name or global mark of `moduleReferences`. */
const marks = /\0@([^\0]*)\0([^\0]*)\0|\0(globalThis\.)?([A-Za-z_$][\w$]*)\0/g;

/**
 * Each runtime binding's name in the module, by its index in
 * `runtime.bindings`: its own, unless a spec name or a binding placed before it
 * takes that name. Declarations are placed before the names the runtime
 * imports from packages.
 */
function runtimeNames(specNames: ReadonlySet<string>) {
  const ownNames = new Set(runtime.bindings.map(({ name }) => name));
  const taken = new Set(specNames);
  const names = runtime.bindings.map(({ name }) => name);
  const order = [...runtime.bindings.keys()].sort(
    (a, b) => rank(runtime.bindings[a]) - rank(runtime.bindings[b]),
  );
  for (const index of order) {
    const own = runtime.bindings[index].name;
    let name = own;
    while (taken.has(name) || (name !== own && ownNames.has(name))) {
      name = `__${name}`;
    }
    taken.add(name);
    names[index] = name;
  }
  return names;
}

function rank(binding: RuntimeBinding) {
  return binding.kind === 'declared' ? 0 : 1;
}

function externalImports(names: readonly string[]) {
  return runtime.bindings
    .flatMap((binding, index) => {
      if (binding.kind !== 'external') return [];
      const local = names[index];
      const name =
        local === binding.name ? local : `${binding.name} as ${local}`;
      return [`import { ${name} } from '${binding.module}';`];
    })
    .join('\n');
}

/** The runtime source with the renamed bindings and the shadowed globals applied. */
function runtimeText(names: readonly string[], specNames: ReadonlySet<string>) {
  const edits: { at: number; length: number; text: string }[] = [];
  for (const [index, binding] of runtime.bindings.entries()) {
    const name = names[index];
    if (name === binding.name) continue;
    const length = binding.name.length;
    for (const at of binding.occurrences)
      edits.push({ at, length, text: name });
    for (const at of binding.shorthands) {
      edits.push({ at, length, text: `${binding.name}: ${name}` });
    }
  }
  for (const global of runtime.globals) {
    if (!specNames.has(global.name)) continue;
    for (const at of global.occurrences) {
      edits.push({ at, length: 0, text: 'globalThis.' });
    }
  }
  edits.sort((a, b) => a.at - b.at);
  let text = '';
  let cursor = 0;
  for (const { at, length, text: replacement } of edits) {
    text += runtime.text.slice(cursor, at) + replacement;
    cursor = at + length;
  }
  return text + runtime.text.slice(cursor);
}
