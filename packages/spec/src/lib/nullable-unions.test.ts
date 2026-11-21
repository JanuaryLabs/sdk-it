import { test } from '@zukhruf/testing/node';
import assert from 'node:assert/strict';
import type { ReferenceObject, SchemaObject } from 'openapi3-ts/oas31';

import { toIR } from '@sdk-it/spec';

// Each union has one branch besides null. A union of either kind, a const and
// a $ref have no type that can say "or null"; only name's branch has (#5136).
const flag: SchemaObject = {
  type: 'object',
  required: ['maybe', 'exclusive', 'mixed', 'toggle', 'either', 'pet', 'name'],
  properties: {
    pet: { anyOf: [{ $ref: '#/components/schemas/Pet' }, { type: 'null' }] },
    name: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    maybe: {
      anyOf: [
        { anyOf: [{ type: 'string' }, { type: 'boolean' }] },
        { type: 'null' },
      ],
    },
    exclusive: {
      oneOf: [
        { oneOf: [{ type: 'string' }, { type: 'boolean' }] },
        { type: 'null' },
      ],
    },
    mixed: {
      anyOf: [
        { oneOf: [{ type: 'string' }, { type: 'boolean' }] },
        { type: 'null' },
      ],
    },
    toggle: { anyOf: [{ const: 'on' }, { type: 'null' }] },
    either: { anyOf: [{ anyOf: [{ type: 'string' }, { type: 'boolean' }] }] },
  },
};

const pet: SchemaObject = {
  type: 'object',
  properties: { name: { type: 'string' } },
};

function members(schema: SchemaObject | ReferenceObject | undefined) {
  assert.ok(schema && !('$ref' in schema), JSON.stringify(schema));
  return [...(schema.anyOf ?? []), ...(schema.oneOf ?? [])];
}

/** A member's $ref, const or type: what it says the value is. */
function label(member: SchemaObject | ReferenceObject) {
  return '$ref' in member ? member.$ref : (member.const ?? member.type);
}

function types(schema: SchemaObject | ReferenceObject | undefined) {
  return members(schema)
    .flatMap((member) =>
      '$ref' in member ? [] : [member.type, ...members(member).map(label)],
    )
    .filter((type) => type !== undefined)
    .sort();
}

void test('toIR keeps a union of null and a branch that cannot hold null, and folds null into a typed branch', async () => {
  // Arrange
  const spec = {
    openapi: '3.1.0',
    info: { title: 'Flags', version: '1.0.0' },
    paths: {},
    components: {
      schemas: {
        Flag: structuredClone(flag),
        Pet: structuredClone(pet),
      },
    },
  };

  // Act
  const ir = await toIR({ spec });

  // Assert
  const normalized = ir.components.schemas.Flag;
  assert.ok(normalized && !('$ref' in normalized), 'Flag');
  const properties = normalized.properties ?? {};
  for (const name of ['maybe', 'exclusive', 'mixed']) {
    assert.deepEqual(
      types(properties[name]),
      ['boolean', 'null', 'string'],
      name,
    );
  }
  assert.deepEqual(members(properties.toggle).map(label), ['on', 'null']);
  assert.deepEqual(types(properties.either), ['boolean', 'string']);
  assert.deepEqual(members(properties.pet).map(label), [
    '#/components/schemas/Pet',
    'null',
  ]);
  assert.deepEqual(properties.name, { type: ['string', 'null'] });
});
