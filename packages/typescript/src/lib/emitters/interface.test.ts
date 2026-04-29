import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { TypeScriptEmitter } from './interface.ts';

const emptySpec = { components: { schemas: {} } } as any;

describe('TypeScriptEmitter date handling', () => {
  test('format date-time returns string', () => {
    const emitter = new TypeScriptEmitter(emptySpec);
    assert.equal(
      emitter.handle({ type: 'string', format: 'date-time' }, true),
      'string',
    );
  });

  test('format datetime returns string', () => {
    const emitter = new TypeScriptEmitter(emptySpec);
    assert.equal(
      emitter.handle({ type: 'string', format: 'datetime' }, true),
      'string',
    );
  });

  test('format date returns string', () => {
    const emitter = new TypeScriptEmitter(emptySpec);
    assert.equal(
      emitter.handle({ type: 'string', format: 'date' }, true),
      'string',
    );
  });

  test('format date-time optional returns string | undefined', () => {
    const emitter = new TypeScriptEmitter(emptySpec);
    assert.equal(
      emitter.handle({ type: 'string', format: 'date-time' }, false),
      'string | undefined',
    );
  });

  test('string without format returns string', () => {
    const emitter = new TypeScriptEmitter(emptySpec);
    assert.equal(emitter.handle({ type: 'string' }, true), 'string');
  });
});

describe('TypeScriptEmitter union of string and string literals', () => {
  test('wraps bare string as (string & {}) when sibling literals are present', () => {
    const emitter = new TypeScriptEmitter(emptySpec);
    const out = emitter.handle(
      {
        anyOf: [
          { enum: ['Director'], type: 'string' },
          { type: 'string' },
          { enum: ['Analyst'], type: 'string' },
        ],
      },
      true,
    );
    assert.equal(out, "'Director' | (string & {}) | 'Analyst'");
  });

  test('does not wrap bare string when no literal siblings', () => {
    const emitter = new TypeScriptEmitter(emptySpec);
    const out = emitter.handle(
      { anyOf: [{ type: 'string' }, { type: 'number' }] },
      true,
    );
    assert.equal(out, 'string | number');
  });

  test('does not wrap when bare string has format', () => {
    const emitter = new TypeScriptEmitter(emptySpec);
    const out = emitter.handle(
      {
        anyOf: [
          { enum: ['Director'], type: 'string' },
          { type: 'string', format: 'date-time' },
        ],
      },
      true,
    );
    assert.equal(out, "'Director' | string");
  });

  test('emits a single (string & {}) when union has duplicate bare strings', () => {
    const emitter = new TypeScriptEmitter(emptySpec);
    const out = emitter.handle(
      {
        anyOf: [
          { type: 'string' },
          { type: 'string' },
          { enum: ['Director'], type: 'string' },
        ],
      },
      true,
    );
    assert.equal(out, "(string & {}) | 'Director'");
  });

  test('wraps bare string when sibling uses const (not enum)', () => {
    const emitter = new TypeScriptEmitter(emptySpec);
    const out = emitter.handle(
      {
        anyOf: [{ type: 'string' }, { const: 'Director', type: 'string' }],
      },
      true,
    );
    assert.equal(out, "(string & {}) | 'Director'");
  });

  test('does not wrap when sibling literal is non-string (numeric const)', () => {
    const emitter = new TypeScriptEmitter(emptySpec);
    const out = emitter.handle(
      { anyOf: [{ type: 'string' }, { const: 1 }] },
      true,
    );
    assert.equal(out, 'string | 1');
  });

  test('wraps bare string when literal sibling is a $ref', () => {
    const specWithRefs = {
      components: {
        schemas: {
          DirectorRole: { const: 'Director', type: 'string' },
        },
      },
    } as any;
    const emitter = new TypeScriptEmitter(specWithRefs);
    const out = emitter.handle(
      {
        anyOf: [
          { type: 'string' },
          { $ref: '#/components/schemas/DirectorRole' },
        ],
      },
      true,
    );
    assert.equal(out, "(string & {}) | 'Director'");
  });
});
