import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { SchemaObject } from 'openapi3-ts/oas31';

import { annotationsOf, requiredOn, toIR } from '@sdk-it/spec';

async function irOf(schemas: Record<string, SchemaObject>) {
  return toIR({
    spec: {
      openapi: '3.1.0',
      info: { title: 'Annotations', version: '1.0.0' },
      components: { schemas },
      paths: {
        '/records': {
          post: {
            operationId: 'createRecord',
            requestBody: {
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Payload' },
                },
              },
            },
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/Payload' },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
}

function payloadOf(ir: Awaited<ReturnType<typeof irOf>>) {
  const payload = ir.components?.schemas?.['Payload'];
  assert.ok(payload && !('$ref' in payload), 'Payload is not a schema');
  return payload;
}

function propertyOf(ir: Awaited<ReturnType<typeof irOf>>, name: string) {
  const payload = payloadOf(ir);
  const property = payload.properties?.[name];
  assert.ok(property, `Payload has no property ${name}`);
  return property;
}

describe('annotationsOf', () => {
  it('reads the annotations of an inline schema', async () => {
    const ir = await irOf({
      Payload: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            title: 'Name',
            description: 'The display name',
            default: 'anonymous',
            deprecated: true,
            readOnly: true,
            examples: ['Ada'],
          },
        },
      },
    });

    const annotations = annotationsOf(propertyOf(ir, 'name'), ir);

    assert.deepEqual(annotations, {
      title: 'Name',
      description: 'The display name',
      default: 'anonymous',
      deprecated: true,
      readOnly: true,
      writeOnly: false,
      examples: ['Ada'],
    });
  });

  it('prefers the title, description and default beside a $ref over its target', async () => {
    const ir = await irOf({
      Status: {
        type: 'string',
        title: 'Status',
        description: 'A status',
        default: 'open',
      },
      Payload: {
        type: 'object',
        properties: {
          status: {
            $ref: '#/components/schemas/Status',
            title: 'Record status',
            description: 'The status of the record',
            default: 'closed',
          },
        },
      },
    });

    const annotations = annotationsOf(propertyOf(ir, 'status'), ir);

    assert.equal(annotations.title, 'Record status');
    assert.equal(annotations.description, 'The status of the record');
    assert.equal(annotations.default, 'closed');
  });

  it("falls back to the target's title, description and default when the $ref has none beside it", async () => {
    const ir = await irOf({
      Status: {
        type: 'string',
        title: 'Status',
        description: 'A status',
        default: 'open',
      },
      Payload: {
        type: 'object',
        properties: { status: { $ref: '#/components/schemas/Status' } },
      },
    });

    const annotations = annotationsOf(propertyOf(ir, 'status'), ir);

    assert.equal(annotations.title, 'Status');
    assert.equal(annotations.description, 'A status');
    assert.equal(annotations.default, 'open');
  });

  for (const flag of ['deprecated', 'readOnly', 'writeOnly'] as const) {
    for (const layer of [
      'beside the $ref',
      'on the middle link',
      'on the last target',
    ] as const) {
      it(`reads ${flag} ${layer} of a $ref chain`, async () => {
        const ir = await irOf({
          Inner: {
            type: 'string',
            ...(layer === 'on the last target' ? { [flag]: true } : {}),
          },
          Outer: {
            $ref: '#/components/schemas/Inner',
            ...(layer === 'on the middle link' ? { [flag]: true } : {}),
          },
          Payload: {
            type: 'object',
            properties: {
              field: {
                $ref: '#/components/schemas/Outer',
                ...(layer === 'beside the $ref' ? { [flag]: true } : {}),
              },
            },
          },
        });

        const annotations = annotationsOf(propertyOf(ir, 'field'), ir);

        assert.equal(annotations[flag], true);
        for (const other of ['deprecated', 'readOnly', 'writeOnly'] as const) {
          if (other !== flag) assert.equal(annotations[other], false);
        }
      });
    }
  }

  it('flattens the examples beside a $ref and of its target, reading example as one example', async () => {
    const ir = await irOf({
      Status: { type: 'string', examples: ['open', 'closed'] },
      Payload: {
        type: 'object',
        properties: {
          status: {
            $ref: '#/components/schemas/Status',
            examples: ['archived'],
            example: 'draft',
          },
        },
      },
    });

    const annotations = annotationsOf(propertyOf(ir, 'status'), ir);

    assert.deepEqual(annotations.examples.toSorted(), [
      'archived',
      'closed',
      'draft',
      'open',
    ]);
  });

  it('keeps a null default apart from no default', async () => {
    const ir = await irOf({
      Payload: {
        type: 'object',
        properties: {
          nothing: { type: ['string', 'null'], default: null },
          absent: { type: 'string' },
        },
      },
    });

    const withNull = annotationsOf(propertyOf(ir, 'nothing'), ir);
    const without = annotationsOf(propertyOf(ir, 'absent'), ir);

    assert.ok('default' in withNull);
    assert.equal(withNull.default, null);
    assert.ok(!('default' in without));
  });

  it('throws naming the cycle when a $ref chain comes back to a schema it already followed', async () => {
    const ir = await irOf({
      A: { $ref: '#/components/schemas/B' },
      B: { $ref: '#/components/schemas/A' },
      Payload: {
        type: 'object',
        properties: { field: { $ref: '#/components/schemas/A' } },
      },
    });

    assert.throws(() => annotationsOf(propertyOf(ir, 'field'), ir), {
      message:
        /^Circular \$ref #\/components\/schemas\/A -> #\/components\/schemas\/B -> #\/components\/schemas\/A:/,
    });
  });

  it('takes the title, description and default from the nearest link of a three-link $ref chain', async () => {
    const ir = await irOf({
      Target: {
        type: 'string',
        title: 'Target title',
        description: 'Target description',
        default: 'target',
      },
      Middle: {
        $ref: '#/components/schemas/Target',
        title: 'Middle title',
        description: 'Middle description',
      },
      Payload: {
        type: 'object',
        properties: {
          field: { $ref: '#/components/schemas/Middle', title: 'Field title' },
        },
      },
    });

    const annotations = annotationsOf(propertyOf(ir, 'field'), ir);

    assert.equal(annotations.title, 'Field title');
    assert.equal(annotations.description, 'Middle description');
    assert.equal(annotations.default, 'target');
  });

  it('takes the description beside a $ref and the title of its target when each has only one', async () => {
    const ir = await irOf({
      Status: { type: 'string', title: 'Status' },
      Payload: {
        type: 'object',
        properties: {
          status: {
            $ref: '#/components/schemas/Status',
            description: 'The status of the record',
          },
        },
      },
    });

    const annotations = annotationsOf(propertyOf(ir, 'status'), ir);

    assert.equal(annotations.title, 'Status');
    assert.equal(annotations.description, 'The status of the record');
  });

  it('flattens the examples of a three-link $ref chain nearest first, reading example on the middle link and the target', async () => {
    const ir = await irOf({
      Target: { type: 'string', examples: ['t1'], example: 't2' },
      Middle: {
        $ref: '#/components/schemas/Target',
        examples: ['m1'],
        example: 'm2',
      },
      Payload: {
        type: 'object',
        properties: {
          field: { $ref: '#/components/schemas/Middle', examples: ['f1'] },
        },
      },
    });

    const annotations = annotationsOf(propertyOf(ir, 'field'), ir);

    assert.deepEqual(annotations.examples, ['f1', 'm1', 'm2', 't1', 't2']);
  });

  it("keeps an empty title and a false default beside a $ref over the target's, and collects an example of 0", async () => {
    const ir = await irOf({
      Flag: { type: 'boolean', title: 'Flag', default: true },
      Payload: {
        type: 'object',
        properties: {
          flag: {
            $ref: '#/components/schemas/Flag',
            title: '',
            default: false,
          },
          count: { type: 'integer', example: 0 },
        },
      },
    });

    const flag = annotationsOf(propertyOf(ir, 'flag'), ir);
    const count = annotationsOf(propertyOf(ir, 'count'), ir);

    assert.equal(flag.title, '');
    assert.equal(flag.default, false);
    assert.deepEqual(count.examples, [0]);
  });
});

describe('requiredOn', () => {
  async function flaggedIR() {
    return irOf({
      Id: { type: 'string' },
      Payload: {
        type: 'object',
        properties: {
          id: { $ref: '#/components/schemas/Id', readOnly: true },
          createdAt: { type: 'string', readOnly: true },
          password: { type: 'string', writeOnly: true },
          name: { type: 'string' },
        },
        required: ['id', 'createdAt', 'password', 'name'],
      },
    });
  }

  it('leaves the readOnly properties out of a request, also one written as a $ref with readOnly beside it', async () => {
    const ir = await flaggedIR();

    const required = requiredOn(
      { $ref: '#/components/schemas/Payload' },
      ir,
      'request',
    );

    assert.deepEqual(required, ['password', 'name']);
  });

  it('leaves the writeOnly properties out of a response', async () => {
    const ir = await flaggedIR();

    const required = requiredOn(
      { $ref: '#/components/schemas/Payload' },
      ir,
      'response',
    );

    assert.deepEqual(required, ['id', 'createdAt', 'name']);
  });

  it('does not change the IR', async () => {
    const ir = await flaggedIR();
    const payload = payloadOf(ir);

    requiredOn(payload, ir, 'request');
    requiredOn(payload, ir, 'response');

    assert.deepEqual(payload.required, ['id', 'createdAt', 'password', 'name']);
  });

  it('keeps every required name of a schema with no readOnly or writeOnly property', async () => {
    const ir = await irOf({
      Payload: {
        type: 'object',
        properties: { name: { type: 'string' }, age: { type: 'integer' } },
        required: ['name', 'age'],
      },
    });

    for (const side of ['request', 'response'] as const) {
      assert.deepEqual(
        requiredOn({ $ref: '#/components/schemas/Payload' }, ir, side),
        ['name', 'age'],
      );
    }
  });

  for (const [flag, dropped, kept] of [
    ['readOnly', 'request', 'response'],
    ['writeOnly', 'response', 'request'],
  ] as const) {
    for (const link of ['the $ref target', 'the middle link'] as const) {
      it(`leaves a required ${flag} property out of a ${dropped} and keeps it in a ${kept} when ${link} of its $ref chain is ${flag}`, async () => {
        const ir = await irOf({
          Id: {
            type: 'string',
            ...(link === 'the $ref target' ? { [flag]: true } : {}),
          },
          RecordId: {
            $ref: '#/components/schemas/Id',
            ...(link === 'the middle link' ? { [flag]: true } : {}),
          },
          Payload: {
            type: 'object',
            properties: {
              id: { $ref: '#/components/schemas/RecordId' },
              name: { type: 'string' },
            },
            required: ['id', 'name'],
          },
        });
        const payload = { $ref: '#/components/schemas/Payload' };

        const droppedRequired = requiredOn(payload, ir, dropped);
        const keptRequired = requiredOn(payload, ir, kept);

        assert.deepEqual(droppedRequired, ['name']);
        assert.deepEqual(keptRequired, ['id', 'name']);
      });
    }
  }

  it('keeps the readOnly names required in a response and the writeOnly names required in a request', async () => {
    const ir = await irOf({
      Payload: {
        type: 'object',
        properties: {
          createdAt: { type: 'string', readOnly: true },
          password: { type: 'string', writeOnly: true },
        },
        required: ['createdAt', 'password'],
      },
    });
    const payload = { $ref: '#/components/schemas/Payload' };

    const response = requiredOn(payload, ir, 'response');
    const request = requiredOn(payload, ir, 'request');

    assert.ok(response.includes('createdAt'), 'readOnly dropped from response');
    assert.ok(request.includes('password'), 'writeOnly dropped from request');
  });
});
