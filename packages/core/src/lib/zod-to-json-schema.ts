import * as z from 'zod';

/** A JSON Schema node, or any object a conversion walks. */
type Json = Record<string, unknown>;

export interface ConvertedSchema {
  schema: Json;
  /** zod's input-side flag: the value may be left out. */
  optional: boolean;
  /** The schemas zod names with `.meta({ id })`, by id. */
  components: Record<string, Json>;
}

function isJson(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isObjectLike(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}

function field(value: unknown, key: string): unknown {
  return isObjectLike(value) ? Reflect.get(value, key) : undefined;
}

function defOf(schema: unknown): unknown {
  return field(field(schema, '_zod'), 'def');
}

const CHILD_SCHEMA_KEYS = [
  'innerType',
  'in',
  'out',
  'element',
  'valueType',
  'keyType',
  'left',
  'right',
  'catchall',
  'rest',
];

// zod 4 reads `_zod.def` of every child, so a Zod 3 schema inside a Zod 4 one
// fails with a TypeError that names neither; name the cause instead.
function assertZod4(schema: unknown, seen = new Set<unknown>()): void {
  const version = field(field(schema, '_zod'), 'version');
  if (field(version, 'major') !== 4) {
    throw new Error(
      '@sdk-it/core requires Zod 4 schemas; migrate imported Zod 3 schemas before analysis.',
    );
  }
  if (seen.has(schema)) return;
  seen.add(schema);
  const def = defOf(schema);
  if (!isObjectLike(def)) return;
  for (const key of CHILD_SCHEMA_KEYS) {
    const child = field(def, key);
    if (child) assertZod4(child, seen);
  }
  const getter = field(def, 'getter');
  if (typeof getter === 'function') {
    assertZod4(Reflect.apply(getter, def, []), seen);
  }
  const shape = field(def, 'shape');
  if (isObjectLike(shape)) {
    for (const value of Object.values(shape)) assertZod4(value, seen);
  }
  for (const key of ['options', 'items']) {
    const members = field(def, key);
    if (Array.isArray(members)) {
      for (const member of members) assertZod4(member, seen);
    }
  }
}

function definitionName(ref: unknown): string | undefined {
  return typeof ref === 'string' && ref.startsWith('#/$defs/')
    ? ref.slice('#/$defs/'.length)
    : undefined;
}

function isAnonymous(name: string): boolean {
  return /^__schema[0-9]+$/.test(name);
}

// .meta({ id }) on a schema whose cycle zod already named (z.json() is one)
// writes the id as { $ref: anonymous }: the id names that anonymous
// definition.
function aliasedDefinition(schema: unknown): string | undefined {
  if (!isJson(schema) || Object.keys(schema).length !== 1) {
    return undefined;
  }
  const name = definitionName(schema['$ref']);
  return name && isAnonymous(name) ? name : undefined;
}

function refersTo(node: unknown, ref: string): boolean {
  if (!isObjectLike(node)) return false;
  if (field(node, '$ref') === ref) return true;
  return Object.values(node).some((child) => refersTo(child, ref));
}

/**
 * One zod schema's conversion to the JSON Schema of an OpenAPI document,
 * keeping the components its ids name.
 */
class SchemaConversion {
  readonly components: Record<string, Json> = Object.create(null);

  #addComponent(name: string, schema: unknown) {
    if (!isJson(schema)) {
      throw new Error(`The schema with id "${name}" is not an object.`);
    }
    const existing = this.components[name];
    if (existing && JSON.stringify(existing) !== JSON.stringify(schema)) {
      throw new Error(
        `Two different schemas share the id "${name}"; give each its own .meta({ id }).`,
      );
    }
    this.components[name] = schema;
  }

  // zod writes every schema that carries an id, and every cycle, as a $defs
  // entry; a root with an id becomes a $ref to its own definition, and
  // an id-less root that cycles refers to itself as '#'. Each named
  // definition becomes a component the refs point at; a cycle without a name
  // cannot become one.
  extractComponents(doc: Json, rootId: unknown): unknown {
    const { $defs: rawDefinitions, ...root } = doc;
    const definitions = isJson(rawDefinitions) ? rawDefinitions : {};
    const names = new Map<string, string>();
    const aliases = new Set<string>();
    for (const name of Object.keys(definitions)) {
      if (!isAnonymous(name)) names.set(name, name);
    }
    for (const [name, definition] of Object.entries(definitions)) {
      const anonymous = names.has(name)
        ? aliasedDefinition(definition)
        : undefined;
      if (anonymous && !names.has(anonymous)) {
        names.set(anonymous, name);
        aliases.add(name);
      }
    }
    if (
      Object.keys(definitions).some((name) => !names.has(name)) ||
      (!rootId && refersTo(root, '#'))
    ) {
      throw new Error(
        'A recursive schema has no name; give it .meta({ id }) so it becomes a named component.',
      );
    }
    const rewrite = (node: unknown): unknown => {
      if (Array.isArray(node)) return node.map(rewrite);
      if (!isJson(node)) return node;
      const rewritten: Json = {};
      for (const [key, value] of Object.entries(node)) {
        const target = key === '$ref' ? definitionName(value) : undefined;
        if (target) {
          rewritten['$ref'] = `#/components/schemas/${names.get(target)}`;
        } else {
          rewritten[key] = rewrite(value);
        }
      }
      return rewritten;
    };
    for (const [name, definition] of Object.entries(definitions)) {
      const component = names.get(name);
      if (component && !aliases.has(name)) {
        this.#addComponent(component, rewrite(definition));
      }
    }
    return rewrite(root);
  }

  // Nested toJsonSchema passes (set/map values, pipe outputs) return
  // self-contained documents whose '#' and '#/$defs/*' refs are
  // relative to their own root; each is lifted on its own, innermost first.
  liftEmbedded(node: unknown): unknown {
    if (Array.isArray(node)) return node.map((item) => this.liftEmbedded(item));
    if (!isJson(node)) return node;
    const lifted: Json = {};
    for (const [key, value] of Object.entries(node)) {
      lifted[key] = this.liftEmbedded(value);
    }
    if (!lifted['x-sdkit-embedded-root']) return lifted;
    const {
      'x-sdkit-embedded-root': _root,
      'x-sdkit-embedded-id': id,
      ...doc
    } = lifted;
    return this.extractComponents(doc, id);
  }
}

// Wraps nested conversions: when the embedded document carries an id, refs or
// a $defs block, tag its root so liftEmbedded extracts it.
function convertEmbedded(schema: unknown): Json {
  const { $schema: _ignored, ...doc } = toJsonSchema(schema);
  const id = isZodSchema(schema) ? z.globalRegistry.get(schema)?.id : undefined;
  if (id || doc['$defs'] || JSON.stringify(doc).includes('"$ref"')) {
    doc['x-sdkit-embedded-root'] = true;
    if (id) doc['x-sdkit-embedded-id'] = id;
  }
  return doc;
}

function isZodSchema(schema: unknown): schema is z.core.$ZodType {
  return schema instanceof z.core.$ZodType;
}

/** int64 is a plain number in sdk-it, so a bigint value is written as one. */
function plainJson(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_key, item: unknown) =>
      typeof item === 'bigint' ? Number(item) : item,
    ),
  );
}

// zod has no JSON Schema form for these values; each is written as the wire
// value it travels as.
const unrepresentable: z.core.UnrepresentableHandler<z.core.$ZodTypes> = ({
  zodSchema,
}) => {
  const def = zodSchema._zod.def;
  switch (def.type) {
    case 'date':
      return { type: 'string', format: 'date-time', 'x-zod-type': 'date' };
    case 'bigint': {
      const format = field(zodSchema, 'format');
      // z.bigint()'s format is null; sdk-it reads it as int64.
      return {
        type: 'integer',
        format: typeof format === 'string' ? format : 'int64',
      };
    }
    case 'default':
    case 'prefault':
      return { default: def.defaultValue };
    case 'set':
      return {
        type: 'array',
        uniqueItems: true,
        items: convertEmbedded(def.valueType),
      };
    case 'map':
      return {
        type: 'array',
        items: {
          type: 'array',
          prefixItems: [
            convertEmbedded(def.keyType),
            convertEmbedded(def.valueType),
          ],
          items: false,
          minItems: 2,
          maxItems: 2,
        },
      };
    case 'custom': {
      // z.instanceof(File) and z.instanceof(Blob) keep their class; each is
      // the value z.file() describes.
      const Class = field(zodSchema._zod.bag, 'Class');
      return Class === File || Class === Blob
        ? convertEmbedded(z.file())
        : 'any';
    }
    default:
      return 'any';
  }
};

function toJsonSchema(schema: unknown): Json {
  if (!isZodSchema(schema)) {
    throw new Error('An against must evaluate to a zod schema.');
  }
  return z.toJSONSchema(schema, {
    io: 'input',
    unrepresentable,
    override(ctx) {
      const def = ctx.zodSchema._zod.def;
      const json: Json = ctx.jsonSchema;
      if (field(def, 'coerce')) {
        json['x-zod-type'] = `coerce-${def.type}`;
      }
      // A bigint default (handed back above) or .catch() value fails zod's
      // final JSON pass.
      if (json['default'] !== undefined) {
        json['default'] = plainJson(json['default']);
      }
      // zod writes no OpenAPI discriminator keyword.
      const discriminator = field(def, 'discriminator');
      if (def.type === 'union' && discriminator) {
        json['discriminator'] = { propertyName: discriminator };
      }
      // zod's io 'input' writes only a pipe's input side; sdk-it keeps both,
      // so a client validates z.string().pipe(z.email()) as an email.
      if (def.type === 'pipe') {
        const outJson = convertEmbedded(def.out);
        const outKeys = Object.keys(outJson).filter(
          (key) =>
            key !== 'x-sdkit-embedded-root' && key !== 'x-sdkit-embedded-id',
        );
        if (outKeys.length > 0) {
          const inJson = { ...json };
          const numeric = new Set<unknown>(['number', 'integer']);
          const compatible =
            inJson['type'] === undefined ||
            outJson['type'] === undefined ||
            inJson['type'] === outJson['type'] ||
            (numeric.has(inJson['type']) && numeric.has(outJson['type']));
          if (compatible) {
            for (const key of Object.keys(json)) delete json[key];
            json['allOf'] = [inJson, outJson];
          }
        }
      }
    },
  });
}

/** Converts the value an `against` evaluates to. */
export function convertZodSchema(zodSchema: unknown): ConvertedSchema {
  assertZod4(zodSchema);
  const conversion = new SchemaConversion();
  // zod's own input-side flag: 'optional' for optional/nullish/catch,
  // 'defaulted' for default/prefault, undefined once .nonoptional() applies.
  const optin = field(field(zodSchema, '_zod'), 'optin');
  const optional = optin === 'optional' || optin === 'defaulted';
  const { $schema: _schema, ...rawResult } = toJsonSchema(zodSchema);
  const id = isZodSchema(zodSchema)
    ? z.globalRegistry.get(zodSchema)?.id
    : undefined;
  const lifted = conversion.liftEmbedded(rawResult);
  const schema = conversion.extractComponents(isJson(lifted) ? lifted : {}, id);
  return {
    schema: isJson(schema) ? schema : {},
    optional,
    components: conversion.components,
  };
}
