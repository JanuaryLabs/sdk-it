import type { ReferenceObject, SchemaObject } from 'openapi3-ts/oas31';

type Schema = SchemaObject | ReferenceObject;

export interface TupleElement {
  schema: Schema;
  /** Whether the array must reach this element (`minItems`). */
  required: boolean;
}

/** A JSON Schema 2020-12 tuple: `prefixItems`, then what follows them. */
export interface Tuple {
  elements: [TupleElement, ...TupleElement[]];
  /** The schema of each item after the elements, or undefined when the array holds no more. */
  rest: Schema | undefined;
}

function isSchema(value: unknown): value is Schema {
  return typeof value === 'object' && value !== null;
}

/**
 * The tuple `schema` describes, or undefined when it has no `prefixItems`
 * element: an empty `prefixItems` leaves an array of `items`.
 */
export function tupleOf(schema: SchemaObject): Tuple | undefined {
  const { prefixItems = [], minItems = 0, maxItems } = schema;
  const [first, ...others] = prefixItems;
  if (!first) {
    return undefined;
  }
  // openapi3-ts types items as a schema object, though 2020-12 lets a schema
  // be a boolean: items: false closes the tuple.
  const items: unknown = schema.items;
  const closed =
    items === false ||
    (maxItems !== undefined && maxItems <= prefixItems.length);
  return {
    elements: [
      { schema: first, required: minItems > 0 },
      ...others.map((element, index) => ({
        schema: element,
        required: index + 1 < minItems,
      })),
    ],
    rest: closed ? undefined : isSchema(items) ? items : {},
  };
}
