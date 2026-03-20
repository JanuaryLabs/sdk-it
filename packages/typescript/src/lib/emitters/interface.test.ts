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
