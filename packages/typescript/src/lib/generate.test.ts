import { build as esbuild } from 'esbuild';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';
import type { OpenAPIObject } from 'openapi3-ts/oas31';

import { generate } from '@sdk-it/typescript';

const repoRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
);

function figmaShapedSpec(): OpenAPIObject {
  return {
    openapi: '3.1.0',
    info: { title: 'Figma-shaped API', version: '1.0.0' },
    servers: [{ url: 'https://api.example.com' }],
    security: [{ oauth2: [] }, { personalToken: [] }, { planToken: [] }],
    components: {
      securitySchemes: {
        oauth2: {
          type: 'oauth2',
          flows: {
            authorizationCode: {
              authorizationUrl: 'https://example.com/auth',
              tokenUrl: 'https://example.com/token',
              scopes: {},
            },
          },
        },
        // Two distinct schemes resolving to the SAME header, as in Figma's
        // real spec (PersonalAccessToken + PlanAccessToken → X-Figma-Token).
        personalToken: {
          type: 'apiKey',
          in: 'header',
          name: 'X-Figma-Token',
        },
        planToken: {
          type: 'apiKey',
          in: 'header',
          name: 'X-Figma-Token',
        },
      },
    },
    paths: {
      '/me': {
        get: {
          operationId: 'getMe',
          security: [{ personalToken: [] }, { planToken: [] }],
          responses: {
            '200': {
              description: 'OK',
              content: { 'application/json': { schema: { type: 'object' } } },
            },
          },
        },
      },
      '/files': {
        get: {
          operationId: 'getFiles',
          security: [{ oauth2: [] }, { personalToken: [] }, { planToken: [] }],
          responses: {
            '200': {
              description: 'OK',
              content: { 'application/json': { schema: { type: 'object' } } },
            },
          },
        },
      },
    },
  };
}

function dictionaryRequestSpec(): OpenAPIObject {
  return {
    openapi: '3.1.0',
    info: { title: 'Dictionaries', version: '1.0.0' },
    paths: {
      '/settings': {
        post: {
          operationId: 'updateSettings',
          tags: ['settings'],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    skills: {
                      type: 'object',
                      additionalProperties: {
                        type: 'object',
                        properties: {
                          enabled: { type: 'boolean' },
                        },
                        required: ['enabled'],
                        additionalProperties: false,
                      },
                    },
                    labels: {
                      type: 'object',
                      additionalProperties: { type: 'string' },
                    },
                    profile: {
                      type: 'object',
                      properties: {
                        enabled: { type: 'boolean' },
                      },
                      required: ['enabled'],
                      additionalProperties: false,
                    },
                  },
                  required: ['skills', 'labels', 'profile'],
                  additionalProperties: false,
                },
              },
            },
          },
          responses: {
            '204': { description: 'Updated' },
          },
        },
      },
    },
  };
}

describe('generate — dictionary inputs', () => {
  test('preserves dictionary value schemas through tuning and Zod generation', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'generate-dictionary-'));
    try {
      await generate(dictionaryRequestSpec(), {
        output: dir,
        name: 'Dictionaries',
        readme: false,
      });

      const bundlePath = join(dir, 'settings-schema.cjs');
      await esbuild({
        entryPoints: [join(dir, 'inputs', 'settings.ts')],
        bundle: true,
        outfile: bundlePath,
        format: 'cjs',
        platform: 'node',
        target: 'node20',
        absWorkingDir: dir,
        nodePaths: [join(repoRoot, 'node_modules')],
        logLevel: 'silent',
      });
      const generated = createRequire(import.meta.url)(bundlePath) as {
        updateSettingsSchema: {
          safeParse(value: unknown): { success: boolean };
        };
      };

      assert.equal(
        generated.updateSettingsSchema.safeParse({
          skills: {
            calendar: { enabled: true },
            search: { enabled: false },
          },
          labels: { source: 'manual' },
          profile: { enabled: true },
        }).success,
        true,
        'arbitrary dictionary keys should accept object values',
      );
      assert.equal(
        generated.updateSettingsSchema.safeParse({
          skills: { search: {} },
          labels: { source: 'manual' },
          profile: { enabled: true },
        }).success,
        false,
        'each object dictionary value should require enabled',
      );
      assert.equal(
        generated.updateSettingsSchema.safeParse({
          skills: { search: { enabled: true } },
          labels: { source: 1 },
          profile: { enabled: true },
        }).success,
        false,
        'primitive dictionary values should keep their value schema',
      );
      assert.equal(
        generated.updateSettingsSchema.safeParse({
          skills: { search: { enabled: true } },
          labels: { source: 'manual' },
          profile: { named: { enabled: true } },
        }).success,
        false,
        'an ordinary object should not become a dictionary',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('generate — security options assembly', () => {
  test('per-operation security merged with global security never emits duplicate option keys', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'generate-security-'));
    try {
      await generate(figmaShapedSpec(), {
        output: dir,
        name: 'Figma',
        readme: false,
      });

      const source = readFileSync(join(dir, 'client.ts'), 'utf8');
      const inputsBlock = source.slice(source.indexOf('async defaultInputs'));
      const keysInInputs =
        inputsBlock
          .slice(0, inputsBlock.indexOf('}'))
          .match(/'X-Figma-Token':/g) ?? [];
      assert.equal(
        keysInInputs.length,
        1,
        `defaultInputs must contain the option exactly once, found ${keysInInputs.length}`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// z.instanceof(Blob|File|Request|Response) evaluates the class as a runtime
// value: ReferenceError where the global is missing (browsers without File,
// older Node, workers) and instanceof failures for cross-realm/polyfill
// values. Decided in e62c4e1, documented in docs/recipes/file-upload.md —
// emitted client code must use bare z.custom<T>() instead.
describe('generate — emitted code is cross-runtime portable', () => {
  function uploadSpec(): OpenAPIObject {
    return {
      openapi: '3.1.0',
      info: { title: 'Uploads', version: '1.0.0' },
      servers: [{ url: 'https://api.example.com' }],
      paths: {
        '/files': {
          post: {
            operationId: 'uploadFile',
            requestBody: {
              content: {
                'multipart/form-data': {
                  schema: {
                    type: 'object',
                    properties: {
                      file: { type: 'string', format: 'binary' },
                      preview: { type: 'string', format: 'byte' },
                      attachment: {
                        type: 'string',
                        contentEncoding: 'binary',
                      },
                    },
                    required: ['file'],
                  },
                },
              },
            },
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': { schema: { type: 'object' } },
                },
              },
            },
          },
        },
      },
    };
  }

  // Fast first-line signal: names the exact offending file.
  test('no emitted file references web/Node globals via z.instanceof', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'generate-portable-'));
    try {
      await generate(uploadSpec(), {
        output: dir,
        name: 'Uploads',
        readme: false,
      });

      const offenders = readdirSync(dir, { recursive: true, encoding: 'utf8' })
        .filter((file) => file.endsWith('.ts'))
        .filter((file) =>
          readFileSync(join(dir, file), 'utf8').includes('z.instanceof('),
        );
      assert.deepEqual(
        offenders,
        [],
        'emitted client code must not reference runtime globals via z.instanceof',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Ground truth: execute the bundled SDK in a realm that actually lacks the
  // fetch-API globals, the way a worker or older Node would load it.
  test('generated SDK executes in a runtime without Blob/File/Request/Response', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'generate-vm-'));
    try {
      await generate(uploadSpec(), {
        output: dir,
        name: 'Uploads',
        readme: false,
      });

      const bundle = async () => {
        const outfile = join(dir, 'bundle.cjs');
        await esbuild({
          entryPoints: [join(dir, 'index.ts')],
          bundle: true,
          outfile,
          format: 'cjs',
          platform: 'node',
          target: 'node20',
          absWorkingDir: dir,
          nodePaths: [join(repoRoot, 'node_modules')],
          logLevel: 'silent',
        });
        return readFileSync(outfile, 'utf8');
      };

      const evaluate = (code: string) => {
        const moduleShim = { exports: {} as Record<string, unknown> };
        const context = createContext({
          module: moduleShim,
          exports: moduleShim.exports,
          require: createRequire(import.meta.url),
          console,
          process,
          // Text/URL primitives exist in every target runtime; the
          // fetch-API classes deliberately do not.
          TextEncoder,
          TextDecoder,
          URL,
          URLSearchParams,
        });
        for (const name of [
          'Blob',
          'File',
          'Request',
          'Response',
          'Headers',
          'FormData',
          'fetch',
        ]) {
          assert.equal(
            runInContext(`typeof ${name}`, context),
            'undefined',
            `sandbox must lack ${name}`,
          );
        }
        runInContext(code, context);
        return moduleShim.exports;
      };

      // Module scope of the real SDK — including zod schema construction
      // for the binary upload input — must evaluate without web globals.
      const sdk = evaluate(await bundle());
      assert.ok(sdk['Uploads'], 'client class exported from sandboxed realm');

      // Negative control: reintroduce the historical bug (e62c4e1) and
      // prove this harness catches it.
      const inputsPath = join(dir, 'inputs', 'files.ts');
      const original = readFileSync(inputsPath, 'utf8');
      assert.ok(
        original.includes('z.custom<Blob>()'),
        'binary emission must be present in the generated inputs',
      );
      writeFileSync(
        inputsPath,
        original.replaceAll('z.custom<Blob>()', 'z.instanceof(Blob)'),
      );
      const broken = await bundle();
      assert.throws(() => evaluate(broken), /Blob is not defined/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
