import type { ReferenceObject, SchemaObject } from 'openapi3-ts/oas31';

import { followRef, isEmpty, isRef, parseRef } from '@sdk-it/core';
import { zodStringFormat } from '@sdk-it/core/zod-string-format.js';
import {
  type IR,
  annotationsOf,
  discriminatorOf,
  isInlinable,
  requiredOn,
  tupleOf,
} from '@sdk-it/spec';

import type { ModelNamer } from '../model-name.ts';
import type { References } from '../references.ts';
import { annotationDoc } from './jsdoc.ts';

/** Zod source and the shared schemas it names. */
export interface EmittedZod {
  zod: string;
  /** The names of the shared schemas `zod` references. */
  references: ReadonlySet<string>;
}

type OnRefCallback = (ref: string, schema: EmittedZod) => void;

/**
 * Convert an OpenAPI (JSON Schema style) object into a Zod schema string,
 */
export class ZodEmitter {
  #generatedRefs = new Set<string>();
  /** The shared schemas whose body is being emitted, outermost first. */
  #inProgress = new Set<string>();
  /**
   * For each body or object property being emitted, innermost last, the
   * shared schemas in `#inProgress` it names: its const or its getter is read
   * before their consts exist.
   */
  #backEdges: Set<string>[] = [];
  #spec: IR;
  #modelName: ModelNamer;
  #refs: References;
  #onRef?: OnRefCallback;
  /** The shared schemas each schema being emitted references, innermost last. */
  #references: Set<string>[] = [];
  /**
   * Inlined components met while a shared schema is being emitted: their
   * consts read schemas that are declared only once `#inProgress` empties.
   */
  #waiting: [string, EmittedZod][] = [];

  constructor(
    spec: IR,
    modelName: ModelNamer,
    refs: References,
    onRef?: OnRefCallback,
  ) {
    this.#spec = spec;
    this.#modelName = modelName;
    this.#refs = refs;
    this.#onRef = onRef;
  }

  #object(schema: SchemaObject): string {
    const properties = schema.properties || {};

    const required = requiredOn(schema, this.#spec, 'request');
    const propEntries = Object.entries(properties).map(([key, propSchema]) => {
      const backEdges = new Set<string>();
      this.#backEdges.push(backEdges);
      let zod: string;
      try {
        zod = this.handle(propSchema, required.includes(key));
      } finally {
        this.#backEdges.pop();
      }
      const doc = annotationDoc(annotationsOf(propSchema, this.#spec));
      // A getter reads a schema that reaches this object once it validates,
      // and lets zod infer the recursive type with no annotation.
      const entry = backEdges.size
        ? `get '${key}'() { return ${zod}; }`
        : `'${key}': ${zod}`;
      return `${doc ? `${doc}\n` : ''}${entry}`;
    });

    let additionalProps = '';
    if (schema.additionalProperties) {
      if (typeof schema.additionalProperties === 'object') {
        // e.g. z.record() if it’s an object schema
        const addPropZod = this.handle(schema.additionalProperties, true);
        additionalProps = `.catchall(${addPropZod})`;
      } else if (schema.additionalProperties === true) {
        // free-form additional props
        additionalProps = `.catchall(z.unknown())`;
      }
    }

    // A JSDoc block right after `{` documents nothing, so each property starts a line.
    const shape = propEntries.map((entry) => `\n${entry},`).join('');
    return `z.object({${shape}${shape ? '\n' : ''}})${additionalProps}`;
  }

  #array(schema: SchemaObject, required = false): string {
    const tuple = tupleOf(schema);
    if (tuple) {
      const elements = tuple.elements.map(
        ({ schema: element, required: elementRequired }) =>
          this.handle(element, elementRequired),
      );
      const rest = tuple.rest ? `, ${this.handle(tuple.rest, true)}` : '';
      return `z.tuple([${elements.join(', ')}]${rest})${appendOptional(required)}`;
    }

    const { items } = schema;
    if (!items) {
      return `z.array(z.unknown())${arrayLimits(schema)}${appendOptional(required)}`;
    }

    // If items is a single schema => standard z.array(...)
    const itemsSchema = this.handle(items, true);
    return `z.array(${itemsSchema})${arrayLimits(schema)}${appendOptional(required)}`;
  }

  #suffixes = (required: boolean, nullable: boolean) => {
    return `${nullable ? '.nullable()' : ''}${appendOptional(required)}`;
  };

  /**
   * Convert a basic type (string | number | boolean | object | array, etc.) to Zod.
   * We'll also handle .optional() if needed.
   */
  normal(
    type: string,
    schema: SchemaObject,
    required = false,
    nullable = false,
  ): string {
    switch (type) {
      case 'string':
        return `${this.string(schema)}${this.#suffixes(required, nullable)}`;
      case 'number':
      case 'integer':
        return `${this.#number(schema)}${this.#suffixes(required, nullable)}`;
      case 'boolean':
        return `${schema['x-zod-type'] === 'coerce-boolean' ? 'z.union([z.boolean(), z.stringbool()])' : 'z.boolean()'}${this.#suffixes(required, nullable)}`;
      case 'object':
        return `${this.#object(schema)}${this.#suffixes(required, nullable)}`;
      // required always
      case 'array':
        return this.#array(schema, required);
      case 'null':
        // If "type": "null" alone, this is basically z.null()
        return `z.null()${appendOptional(required)}`;
      default:
        // Unknown type -> fallback
        return `z.unknown()${appendOptional(required)}`;
    }
  }

  #ref($ref: string, required: boolean) {
    const schemaName = this.#modelName(parseRef($ref).model);
    const schema = followRef(this.#spec, $ref);

    if (isInlinable(this.#spec, $ref)) {
      const inlined = this.emit(schema, required);
      for (const name of inlined.references) {
        this.#references.at(-1)?.add(name);
      }
      if (this.#inProgress.size) {
        this.#waiting.push([schemaName, inlined]);
      } else {
        this.#onRef?.(schemaName, inlined);
      }
      return inlined.zod;
    }

    this.#references.at(-1)?.add(schemaName);
    if (this.#generatedRefs.has(schemaName)) {
      if (this.#inProgress.has(schemaName)) {
        this.#backEdges.at(-1)?.add(schemaName);
      }
      return schemaName;
    }
    this.#generatedRefs.add(schemaName);
    this.#inProgress.add(schemaName);
    const backEdges = new Set<string>();
    this.#backEdges.push(backEdges);
    let body: EmittedZod;
    try {
      body = this.emit(schema, required);
    } finally {
      this.#backEdges.pop();
      this.#inProgress.delete(schemaName);
    }
    const modelType = this.#refs.model(schemaName);
    // A schema that reaches itself through no object property (an array, a
    // record or a union of itself) is read only when it validates, and its
    // model type names what TypeScript cannot infer from its own initializer.
    this.#onRef?.(schemaName, {
      zod: backEdges.size
        ? `z.lazy((): z.ZodType<${modelType}, ${modelType}> => ${body.zod})`
        : body.zod,
      references: body.references,
    });
    if (!this.#inProgress.size) {
      for (const [name, inlined] of this.#waiting.splice(0)) {
        this.#onRef?.(name, inlined);
      }
    }

    return schemaName;
  }

  /** `schema` as zod source, with the shared schemas that source references. */
  emit(schema: SchemaObject | ReferenceObject, required: boolean): EmittedZod {
    const references = new Set<string>();
    this.#references.push(references);
    try {
      return { zod: this.handle(schema, required), references };
    } finally {
      this.#references.pop();
    }
  }
  #toIntersection(schemas: string[]): string {
    const [left, ...right] = schemas;
    if (!right.length) {
      return left;
    }
    return `z.intersection(${left}, ${this.#toIntersection(right)})`;
  }

  allOf(schemas: (SchemaObject | ReferenceObject)[], required: boolean) {
    const allOfSchemas = schemas.map((sub) => this.handle(sub, true));
    if (allOfSchemas.length === 0) {
      return `z.unknown()`;
    }
    if (allOfSchemas.length === 1) {
      return `${allOfSchemas[0]}${appendOptional(required)}`;
    }
    return `${this.#toIntersection(allOfSchemas)}${appendOptional(required)}`;
  }

  anyOf(schema: SchemaObject, required: boolean) {
    return this.#union(schema, 'anyOf', required);
  }

  oneOf(schema: SchemaObject, required: boolean) {
    return this.#union(schema, 'oneOf', required);
  }

  /**
   * zod's union returns the first branch that succeeds, and JSON Schema's
   * unions have no order, so the null branch is checked before every other
   * branch, as `.nullable()` does: a coerce branch would turn null into 'null'.
   */
  #union(schema: SchemaObject, kind: 'anyOf' | 'oneOf', required: boolean) {
    const all = schema[kind] ?? [];
    const branches = all
      .filter((sub) => !this.#isNull(sub))
      .map((sub) => this.handle(sub, true));
    if (branches.length === 0) {
      return `z.null()${appendOptional(required)}`;
    }
    const nullable = branches.length < all.length ? '.nullable()' : '';
    return `${this.#branches(schema, kind, branches)}${nullable}${appendOptional(required)}`;
  }

  #branches(schema: SchemaObject, kind: 'anyOf' | 'oneOf', branches: string[]) {
    if (branches.length === 1) {
      return branches[0];
    }
    const discriminated = this.#discriminatedUnion(schema, branches);
    if (discriminated) {
      return discriminated;
    }
    // oneOf is exclusive-or per JSON Schema; z.xor rejects values matching
    // more than one branch, unlike z.union's anyOf semantics.
    return kind === 'oneOf'
      ? `z.xor([${branches.join(', ')}])`
      : `z.union([${branches.join(', ')}])`;
  }

  #isNull(schema: SchemaObject | ReferenceObject) {
    return (
      (isRef(schema)
        ? followRef<SchemaObject>(this.#spec, schema.$ref)
        : schema
      ).type === 'null'
    );
  }

  /**
   * `branches` as a zod discriminated union, which reports an issue at the
   * discriminator, when the spec says that validates the same values.
   */
  #discriminatedUnion(schema: SchemaObject, branches: string[]) {
    const property = discriminatorOf(this.#spec, schema);
    return property === undefined
      ? undefined
      : `z.discriminatedUnion(${JSON.stringify(property)}, [${branches.join(', ')}])`;
  }

  enum(members: unknown[]) {
    // An object or array member is compared by JSON value, not by identity.
    // Members are distinct values, so at most one branch matches.
    if (
      members.some((member) => member !== null && typeof member === 'object')
    ) {
      return `z.union([${members.map(constSchema).join(', ')}])`;
    }
    const values = members.map((member) => JSON.stringify(member));
    if (values.length === 1) {
      return `z.literal(${values.join(', ')})`;
    }
    // Values arrive JSON.stringify'd, so string literals start with a quote.
    // z.enum only takes strings; zod 4 silently filters numeric entries as
    // reverse mappings, so any non-string enum must emit z.literal([...]).
    if (values.every((value) => String(value).startsWith('"'))) {
      return `z.enum([${values.join(', ')}])`;
    }
    return `z.literal([${values.join(', ')}])`;
  }

  /**
   * Handle a `string` schema with possible format keywords (JSON Schema).
   */
  string(schema: SchemaObject): string {
    const base =
      schema['x-zod-type'] === 'coerce-string'
        ? 'z.coerce.string()'
        : 'z.string()';

    // 3.1 replaces `example` in the schema with `examples` (array).
    // We do not strictly need them for the Zod type, so they’re optional
    // for validation. However, we could keep them as metadata if you want.

    if (schema.contentEncoding === 'binary') {
      // Emitted client code must not reference Blob as a runtime value:
      // it throws ReferenceError where the global is missing and fails
      // instanceof for cross-realm/polyfill Blobs (see e62c4e1 and
      // docs/recipes/file-upload.md).
      return `z.custom<${this.#refs.global('Blob')}>()`;
    }

    if (schema.format === 'byte' || schema.format === 'binary') {
      // Bare z.custom on purpose — see the contentEncoding branch above.
      return `z.custom<${this.#refs.global('Blob')}>()`;
    }
    const dateTime =
      schema.format === 'date-time' || schema.format === 'datetime';
    if (dateTime && schema['x-zod-type'] === 'coerce-date') {
      return 'z.coerce.date()';
    }
    if (dateTime && schema['x-zod-type'] === 'date') {
      return 'z.date()';
    }
    if (schema.format === 'phone') {
      return `${base}${stringLimits(schema)} /* or add .regex(...) for phone formats */`;
    }

    const format =
      schema.format === undefined
        ? undefined
        : zodStringFormat(schema.format, schema.pattern);
    if (!format) {
      return `${base}${stringLimits(schema)}`;
    }
    const checked = `${format.code}${stringLimits({ ...schema, pattern: format.pattern })}`;
    return schema['x-zod-type'] === 'coerce-string'
      ? `${base}.pipe(${checked})`
      : checked;
  }

  /**
   * Handle number/integer constraints from OpenAPI/JSON Schema.
   * In 3.1, exclusiveMinimum/Maximum hold the actual numeric threshold,
   * rather than a boolean toggling `minimum`/`maximum`.
   */
  #number(schema: SchemaObject) {
    let base =
      schema['x-zod-type'] === 'coerce-number'
        ? 'z.coerce.number()'
        : 'z.number()';

    if (schema.type === 'integer') {
      base += '.int()';
    }

    // If we see exclusiveMinimum as a number in 3.1:
    if (typeof schema.exclusiveMinimum === 'number') {
      // Zod doesn’t have a direct "exclusiveMinimum" method, so we can do .gt()
      // If exclusiveMinimum=7 => .gt(7)
      base += `.gt(${schema.exclusiveMinimum})`;
    }
    // Similarly for exclusiveMaximum
    if (typeof schema.exclusiveMaximum === 'number') {
      // If exclusiveMaximum=10 => .lt(10)
      base += `.lt(${schema.exclusiveMaximum})`;
    }

    // If standard minimum/maximum
    if (typeof schema.minimum === 'number') {
      base += `.min(${schema.minimum})`;
    }
    if (typeof schema.maximum === 'number') {
      base += `.max(${schema.maximum})`;
    }

    // zod's multipleOf is float-safe: Number.isInteger(0.7 / 0.001) is false.
    if (typeof schema.multipleOf === 'number') {
      base += `.multipleOf(${schema.multipleOf})`;
    }

    return base;
  }

  handle(schema: SchemaObject | ReferenceObject, required: boolean): string {
    if (isRef(schema)) {
      return `${this.#ref(schema.$ref, true)}${appendOptional(required)}`;
    }

    if (schema.not && isEmpty(schema.not)) {
      return `z.never()${appendOptional(required)}`;
    }

    // Handle allOf → intersection
    if (schema.allOf && Array.isArray(schema.allOf)) {
      return this.allOf(schema.allOf ?? [], required);
    }

    // anyOf → union
    if (schema.anyOf && Array.isArray(schema.anyOf)) {
      return this.anyOf(schema, required);
    }

    // oneOf → union
    if (schema.oneOf && Array.isArray(schema.oneOf) && schema.oneOf.length) {
      return this.oneOf(schema, required);
    }

    if (schema.const !== undefined) {
      return `${constSchema(schema.const)}${appendOptional(required)}`;
    }

    // enum
    if (schema.enum && Array.isArray(schema.enum)) {
      return `${this.enum(schema.enum)}${appendOptional(required)}`;
    }

    // 3.1 can have type: string or type: string[] (e.g. ["string","null"])
    // Let's parse that carefully.
    const types = Array.isArray(schema.type)
      ? schema.type
      : schema.type
        ? [schema.type]
        : [];

    // If no explicit "type", fallback to unknown
    if (!types.length) {
      return `z.unknown()${appendOptional(required)}`;
    }

    // If it's a union type (like ["string", "null"]), we'll build a Zod union
    // or apply .nullable() if it's just "type + null".

    // backward compatibility with openapi 3.0
    if ('nullable' in schema && schema.nullable) {
      types.push('null');
    }

    if (types.length > 1) {
      // If it’s exactly one real type plus "null", we can do e.g. `z.string().nullable()`
      const realTypes = types.filter((t) => t !== 'null');
      if (realTypes.length === 1 && types.includes('null')) {
        // Single real type + "null"
        return this.normal(
          realTypes[0],
          { ...schema, type: realTypes[0] },
          required,
          true,
        );
      }
      // A union of several types, its null checked first as in #union.
      const subSchemas = realTypes.map((t) =>
        this.normal(t, { ...schema, type: t }, true),
      );
      const nullable = realTypes.length < types.length ? '.nullable()' : '';
      return `z.union([${subSchemas.join(', ')}])${nullable}${appendOptional(required)}`;
    }
    return this.normal(types[0], schema, required, false);
  }
}

function appendOptional(isRequired?: boolean) {
  return isRequired ? '' : '.optional()';
}

/** JSON Schema's array length keywords, mapped as zod's own `z.fromJSONSchema` maps them. */
function arrayLimits(schema: SchemaObject) {
  let limits = '';
  if (typeof schema.minItems === 'number') {
    limits += `.min(${schema.minItems})`;
  }
  if (typeof schema.maxItems === 'number') {
    limits += `.max(${schema.maxItems})`;
  }
  return limits;
}

/** JSON Schema's string length and pattern keywords, mapped as zod's own `z.fromJSONSchema` maps them. */
function stringLimits(schema: SchemaObject) {
  let limits = '';
  if (typeof schema.minLength === 'number') {
    limits += `.min(${schema.minLength})`;
  }
  if (typeof schema.maxLength === 'number') {
    limits += `.max(${schema.maxLength})`;
  }
  if (typeof schema.pattern === 'string') {
    limits += `.regex(${regexLiteral(schema.pattern)})`;
  }
  return limits;
}

/**
 * A regular expression literal for a JSON Schema `pattern`, which is an
 * ECMA-262 regular expression that is not anchored. Compiling it here fails
 * generation on a pattern that JavaScript rejects, instead of the SDK failing
 * when it is imported. The literal names no global that a spec name can hide.
 */
function regexLiteral(pattern: string) {
  try {
    return `/${new RegExp(pattern).source}/`;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new SyntaxError(
        `The pattern ${JSON.stringify(pattern)} is not an ECMA-262 regular expression: ${error.message}`,
        { cause: error },
      );
    }
    throw error;
  }
}

/**
 * A schema that accepts exactly one JSON value, as JSON Schema compares a
 * `const`: by value, element by element and key by key, with no other keys.
 */
function constSchema(value: unknown): string {
  if (value === null) {
    return 'z.null()';
  }
  if (Array.isArray(value)) {
    return `z.tuple([${value.map(constSchema).join(', ')}])`;
  }
  if (typeof value === 'object') {
    const shape = Object.entries(value).map(
      ([key, item]) => `${JSON.stringify(key)}: ${constSchema(item)}`,
    );
    return `z.strictObject({ ${shape.join(', ')} })`;
  }
  return `z.literal(${JSON.stringify(value)})`;
}
