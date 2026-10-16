import { settleWithin } from '@zukhruf/testing/async';
import { test } from '@zukhruf/testing/node';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import type { ResponseObject } from 'openapi3-ts/oas31';

import { resolveRef } from '@sdk-it/core/ref.js';
import {
  type IR,
  type ProcessingDiagnostic,
  enrichExamples,
  processSpec,
} from '@sdk-it/spec';

void test.each(
  [new Error('cancel processing'), 'cancel processing'],
  (reason) =>
    test(`processing aborts a pending plugin with ${typeof reason} reason`, async () => {
      const controller = new AbortController();
      const pending = Promise.withResolvers<void>();
      let nextPluginRan = false;
      const processing = processSpec({
        spec: {
          openapi: '3.1.0',
          info: { title: 'Cancellation', version: '1' },
          paths: {},
        },
        signal: controller.signal,
        plugins: [
          { name: 'pending', process: () => pending.promise },
          {
            name: 'next',
            process: () => {
              nextPluginRan = true;
            },
          },
        ],
      });
      const rejected = assert.rejects(processing, (error) => error === reason);

      try {
        controller.abort(reason);
        await settleWithin(rejected, 'processing cancellation');
        assert.equal(nextPluginRan, false);
      } finally {
        pending.resolve();
        await rejected;
      }
    }),
);

void test.each(['generate', 'validate'] as const, (phase) =>
  test.each(['valid', 'invalid', 'rejected'] as const, (result) =>
    test(`aborting example ${phase} ignores a late ${result} result`, async () => {
      const controller = new AbortController();
      const reason = new Error('stop examples');
      const entered = Promise.withResolvers<void>();
      const pending = Promise.withResolvers<unknown>();
      const finished = Promise.withResolvers<void>();
      const diagnostics: ProcessingDiagnostic[] = [];
      const observed: IR[] = [];
      let validations = 0;
      let nextPluginRan = false;
      const enrichment = enrichExamples({
        generate({ spec, signal }) {
          assert.equal(signal, controller.signal);
          observed.push(spec);
          if (phase === 'generate') {
            entered.resolve();
            return pending.promise;
          }
          return 'generated';
        },
        async validate({ signal }) {
          assert.equal(signal, controller.signal);
          validations++;
          entered.resolve();
          return Boolean(await pending.promise);
        },
      });
      const processing = processSpec({
        spec: {
          openapi: '3.1.0',
          info: { title: 'Examples', version: '1' },
          paths: {
            '/example': {
              get: {
                responses: {
                  '200': {
                    description: 'Example',
                    content: {
                      'application/json': { schema: { type: 'string' } },
                    },
                  },
                },
              },
            },
          },
        },
        signal: controller.signal,
        onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
        plugins: [
          {
            ...enrichment,
            async process(context) {
              try {
                await enrichment.process(context);
              } finally {
                finished.resolve();
              }
            },
          },
          {
            name: 'next',
            process: () => {
              nextPluginRan = true;
            },
          },
        ],
      });
      const rejected = assert.rejects(processing, (error) => error === reason);

      try {
        await settleWithin(entered.promise, 'example callback');
        controller.abort(reason);
        await settleWithin(rejected, 'pipeline cancellation');
        await settleWithin(finished.promise, 'example plugin cancellation');
      } finally {
        controller.abort(reason);
        if (result === 'rejected') pending.reject(new Error('late failure'));
        else
          pending.resolve(
            phase === 'generate'
              ? result === 'valid'
                ? 'generated'
                : 42
              : result === 'valid',
          );
        await finished.promise;
        await rejected;
      }
      await setImmediate();
      const operation = observed[0].paths['/example'].get;
      assert.ok(operation?.responses);
      const response = resolveRef<ResponseObject>(
        observed[0],
        operation.responses['200'],
      );
      assert.ok(response.content);
      assert.equal(response.content['application/json'].example, undefined);
      assert.deepEqual(diagnostics, []);
      assert.equal(validations, phase === 'validate' ? 1 : 0);
      assert.equal(nextPluginRan, false);
    }),
  ),
);
