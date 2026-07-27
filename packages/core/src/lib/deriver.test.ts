import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import ts from 'typescript';

import { $types, TypeDeriver, deriveSymbol, toSchema } from '@sdk-it/core';

async function createTestProject(
  code: string,
  compilerOptions: ts.CompilerOptions = {},
) {
  const testDir = await mkdtemp(join(tmpdir(), 'ts-deriver-test-'));
  const filePath = join(testDir, 'main.ts');

  await writeFile(filePath, code);

  const program = ts.createProgram([filePath], {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    strict: true,
    ...compilerOptions,
  });

  const checker = program.getTypeChecker();
  const sourceFile = program.getSourceFile(filePath);

  if (!sourceFile) throw new Error('Could not load source file');

  return {
    checker,
    sourceFile,
    cleanup: () => rm(testDir, { recursive: true, force: true }),
  };
}

async function deriveTypeFromCode(code: string, targetName: string) {
  const { checker, sourceFile, cleanup } = await createTestProject(code);
  try {
    const deriver = new TypeDeriver(checker);
    let targetNode: ts.Node | undefined;

    function visit(node: ts.Node) {
      if (
        (ts.isTypeAliasDeclaration(node) ||
          ts.isInterfaceDeclaration(node) ||
          ts.isClassDeclaration(node)) &&
        node.name?.text === targetName
      ) {
        targetNode = node;
      } else {
        ts.forEachChild(node, visit);
      }
    }
    visit(sourceFile);

    if (!targetNode) {
      throw new Error(`Symbol '${targetName}' not found in test code.`);
    }

    const type = checker.getTypeAtLocation(targetNode);
    return deriver.serializeType(type);
  } finally {
    await cleanup();
  }
}

async function deriveExpressionFromCode(
  code: string,
  targetName: string,
  typesMap?: Record<string, string>,
  compilerOptions?: ts.CompilerOptions,
) {
  const { checker, sourceFile, cleanup } = await createTestProject(
    code,
    compilerOptions,
  );
  try {
    const deriver = new TypeDeriver(checker, typesMap);
    let targetNode: ts.Expression | undefined;

    function visit(node: ts.Node) {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === targetName &&
        node.initializer
      ) {
        targetNode = node.initializer;
      } else {
        ts.forEachChild(node, visit);
      }
    }
    visit(sourceFile);

    if (!targetNode) {
      throw new Error(
        `Initializer for '${targetName}' not found in test code.`,
      );
    }

    return deriver.serializeNode(targetNode);
  } finally {
    await cleanup();
  }
}

describe('Type Derivation', () => {
  describe('Primitives & Literals', () => {
    test('identifies basic primitives', async () => {
      const code = `
        export type A = string;
        export type B = number;
        export type C = boolean;
      `;

      const resA = await deriveTypeFromCode(code, 'A');
      assert.deepStrictEqual(resA, {
        [deriveSymbol]: true,
        optional: false,
        [$types]: ['string'],
      });

      const resB = await deriveTypeFromCode(code, 'B');
      assert.deepStrictEqual(resB, {
        [deriveSymbol]: true,
        optional: false,
        [$types]: ['number'],
      });

      const resC = await deriveTypeFromCode(code, 'C');
      assert.deepStrictEqual(resC, {
        [deriveSymbol]: true,
        optional: false,
        [$types]: ['boolean'],
      });
    });

    test('identifies literal values', async () => {
      const result = await deriveTypeFromCode(
        `export type Status = 200;`,
        'Status',
      );
      assert.deepStrictEqual(result, {
        [deriveSymbol]: true,
        optional: false,
        kind: 'literal',
        value: 200,
        [$types]: ['number'],
      });
    });

    test('identifies string literal', async () => {
      const result = await deriveTypeFromCode(
        `export type Greeting = "hello";`,
        'Greeting',
      );
      assert.deepStrictEqual(result, {
        [deriveSymbol]: true,
        optional: false,
        kind: 'literal',
        value: 'hello',
        [$types]: ['string'],
      });
    });

    test('identifies true literal', async () => {
      const result = await deriveTypeFromCode(
        `export type AlwaysTrue = true;`,
        'AlwaysTrue',
      );
      assert.deepStrictEqual(result, {
        [deriveSymbol]: true,
        optional: false,
        kind: 'literal',
        value: true,
        [$types]: ['boolean'],
      });
    });

    test('identifies false literal', async () => {
      const result = await deriveTypeFromCode(
        `export type AlwaysFalse = false;`,
        'AlwaysFalse',
      );
      assert.deepStrictEqual(result, {
        [deriveSymbol]: true,
        optional: false,
        kind: 'literal',
        value: false,
        [$types]: ['boolean'],
      });
    });
    test('identifies template literal', async () => {
      const result = await deriveTypeFromCode(
        'export type Route = `/${string}`;',
        'Route',
      );
      assert.deepStrictEqual(result, {
        [deriveSymbol]: true,
        optional: false,
        [$types]: ['string'],
      });
    });

    test('identifies null type', async () => {
      const result = await deriveTypeFromCode(
        `export type Nothing = null;`,
        'Nothing',
      );
      assert.deepStrictEqual(result, {
        [deriveSymbol]: true,
        optional: false,
        [$types]: ['null'],
      });
    });

    test('identifies any type', async () => {
      const result = await deriveTypeFromCode(
        `export type Anything = any;`,
        'Anything',
      );
      assert.deepStrictEqual(result, {
        [deriveSymbol]: true,
        optional: false,
        [$types]: [],
      });
    });

    test('emits an impossible schema for never', async () => {
      const result = toSchema(
        await deriveTypeFromCode(
          `export type Impossible = never;`,
          'Impossible',
        ),
      );
      assert.deepStrictEqual(result, { not: {} });
    });

    test('emits impossible array items for never arrays', async () => {
      const result = toSchema(
        await deriveTypeFromCode(
          `export type ImpossibleList = never[];`,
          'ImpossibleList',
        ),
      );
      assert.deepStrictEqual(result, {
        type: 'array',
        items: { not: {} },
      });
    });

    test('identifies unknown type', async () => {
      const result = await deriveTypeFromCode(
        `export type Mystery = unknown;`,
        'Mystery',
      );
      assert.deepStrictEqual(result, {
        [deriveSymbol]: true,
        optional: false,
        [$types]: [],
      });
    });
  });

  describe('Complex Objects & Interfaces', () => {
    test.todo('derives interface with nested properties');
    test.todo('handles inheritance');
    test.todo('derives class with properties');
    test.todo('derives object literal type');
  });

  describe('Collections', () => {
    test.todo('handles arrays of primitives');
    test.todo('handles arrays of objects');
    test.todo('handles tuples');

    test('widens const-asserted array values to their item type', async () => {
      const result = toSchema(
        await deriveExpressionFromCode(
          `
            export const indicators = [
              { id: 1, description: 'first' },
              { id: 2, description: 'second' },
            ] as const;
          `,
          'indicators',
        ),
      );

      assert.deepStrictEqual(result, {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            description: { type: 'string' },
            id: { type: 'number' },
          },
          required: ['description', 'id'],
          additionalProperties: false,
        },
      });
    });

    test('infers nested const-asserted arrays as matrices', async () => {
      const result = toSchema(
        await deriveExpressionFromCode(
          `
            export const matrix = [
              [1, 2],
              [3, 4],
            ] as const;
          `,
          'matrix',
        ),
      );

      assert.deepStrictEqual(result, {
        type: 'array',
        items: {
          type: 'array',
          items: { type: 'number' },
        },
      });
    });

    test('handles Record type', async () => {
      const result = await deriveTypeFromCode(
        `export type Payload = Record<string, unknown>;`,
        'Payload',
      );
      assert.deepStrictEqual(result, {
        [deriveSymbol]: true,
        kind: 'record',
        optional: false,
        [$types]: [
          {
            [deriveSymbol]: true,
            optional: false,
            [$types]: [],
          },
        ],
      });
    });
  });

  describe('Unions & Intersections', () => {
    test.todo('collapses unions correctly');
    test.todo('handles optional via union with undefined');
    test.todo('handles intersection types');
    test.todo('handles discriminated unions');

    // TS subsumes the literals into `string` here. See sibling test
    // "union of (string & {}) and string literals preserves literals" for the
    // workaround that prevents collapse.
    test('union of string and string literals', async () => {
      const code = `
        export type EmployeePosition =
          | string
          | 'Director'
          | 'Associate Director'
          | 'Project Leader'
          | 'Delivery Leader'
          | 'Associate'
          | 'Analyst'
          | 'Unknown';
      `;
      const result = await deriveTypeFromCode(code, 'EmployeePosition');
      assert.deepStrictEqual(result, {
        [deriveSymbol]: true,
        optional: false,
        [$types]: ['string'],
      });
    });

    test('union of (string & {}) and string literals preserves literals', async () => {
      const code = `
        export type EmployeePosition =
          | (string & {})
          | 'Director'
          | 'Associate Director'
          | 'Project Leader'
          | 'Delivery Leader'
          | 'Associate'
          | 'Analyst'
          | 'Unknown';
      `;
      const result = await deriveTypeFromCode(code, 'EmployeePosition');
      const literal = (value: string) => ({
        [deriveSymbol]: true,
        optional: false,
        kind: 'literal',
        value,
        [$types]: ['string'],
      });
      // `__type` is TS's synthetic name for anonymous/empty object types — the
      // `& {}` member shows up as a placeholder. `paths.ts:toSchema` strips it
      // when emitting OpenAPI (see ANON_OBJECT there).
      assert.deepStrictEqual(result, {
        [deriveSymbol]: true,
        optional: false,
        kind: 'union',
        [$types]: [
          {
            [deriveSymbol]: true,
            optional: false,
            kind: 'intersection',
            [$types]: [
              { [deriveSymbol]: true, optional: false, [$types]: ['string'] },
              { [deriveSymbol]: true, optional: false, [$types]: ['__type'] },
            ],
          },
          literal('Director'),
          literal('Associate Director'),
          literal('Project Leader'),
          literal('Delivery Leader'),
          literal('Associate'),
          literal('Analyst'),
          literal('Unknown'),
        ],
      });
    });
  });

  describe('Type Mappings', () => {
    test.todo('uses default typesMap for built-in types');
    test.todo('uses custom typesMap');
  });

  describe('AST Node Serialization', () => {
    test.todo('handles typeof expressions');
    test.todo('handles const assertions');

    test('derives satisfies expressions from the annotation', async () => {
      const code = `
        export interface ChatShare { id: string; token: string; }
        export const empty = [] satisfies ChatShare[];
      `;

      const result = toSchema(
        await deriveExpressionFromCode(code, 'empty', {
          ChatShare: '#/components/schemas/ChatShare',
        }),
      );

      assert.deepStrictEqual(result, {
        type: 'array',
        items: { $ref: '#/components/schemas/ChatShare' },
      });
    });

    test('derives satisfies expressions used as object literal properties', async () => {
      // The object literal branch read property initializers as
      // `serializeType(getTypeAtLocation(init))`, which bypasses the satisfies
      // handling below and yields `never[]`. That is the shape endpoints
      // actually return -- `c.json({ messages: [] satisfies UIMessage[] })` --
      // so the mapped name never reached typesMap and the property emitted a
      // nested `{type:'any'}` array instead.
      const code = `
        export interface UIMessage { id: string; parts: UIMessage[]; }
        export const payload = { messages: [] satisfies UIMessage[] };
      `;

      const result = await deriveExpressionFromCode(code, 'payload', {
        UIMessage: '#/components/schemas/JsonObject',
      });

      assert.deepStrictEqual(result.messages, {
        [deriveSymbol]: true,
        kind: 'array',
        optional: false,
        [$types]: ['#/components/schemas/JsonObject'],
      });
    });

    test('preserves literal response properties checked with satisfies', async () => {
      const result = toSchema(
        await deriveExpressionFromCode(
          `export const payload = { status: 'ok' satisfies string };`,
          'payload',
        ),
      );

      assert.deepStrictEqual(result, {
        type: 'object',
        properties: {
          status: { enum: ['ok'], type: 'string' },
        },
        required: ['status'],
        additionalProperties: false,
      });
    });

    test('recovers empty-array satisfies annotations without strict null checks', async () => {
      const result = toSchema(
        await deriveExpressionFromCode(
          `
            export interface UIMessage { id: string; }
            export const payload = {
              messages: [] satisfies UIMessage[],
            };
          `,
          'payload',
          { UIMessage: '#/components/schemas/JsonObject' },
          { strictNullChecks: false },
        ),
      );

      assert.deepStrictEqual(result.properties.messages, {
        type: 'array',
        items: { $ref: '#/components/schemas/JsonObject' },
      });
    });

    test('keeps the inferred empty-array type for non-array satisfies targets', async () => {
      const result = toSchema(
        await deriveExpressionFromCode(
          `export const payload = [] satisfies unknown;`,
          'payload',
        ),
      );

      assert.deepStrictEqual(result, {
        type: 'array',
        items: { not: {} },
      });
    });

    test('recovers satisfies annotations in nested response properties', async () => {
      const result = toSchema(
        await deriveExpressionFromCode(
          `
            export interface UIMessage { id: string; }
            export const payload = {
              data: { messages: [] satisfies UIMessage[] },
            };
          `,
          'payload',
          { UIMessage: '#/components/schemas/JsonObject' },
        ),
      );

      assert.deepStrictEqual(result, {
        type: 'object',
        properties: {
          data: {
            type: 'object',
            properties: {
              messages: {
                type: 'array',
                items: { $ref: '#/components/schemas/JsonObject' },
              },
            },
            required: ['messages'],
            additionalProperties: false,
          },
        },
        required: ['data'],
        additionalProperties: false,
      });
    });

    test('recovers satisfies annotations from shorthand response properties', async () => {
      const result = toSchema(
        await deriveExpressionFromCode(
          `
            export interface UIMessage { id: string; }
            const messages = [] satisfies UIMessage[];
            export const payload = { messages };
          `,
          'payload',
          { UIMessage: '#/components/schemas/JsonObject' },
        ),
      );

      assert.deepStrictEqual(result, {
        type: 'object',
        properties: {
          messages: {
            type: 'array',
            items: { $ref: '#/components/schemas/JsonObject' },
          },
        },
        required: ['messages'],
        additionalProperties: false,
      });
    });

    test('recovers shorthand satisfies annotations inside nested objects', async () => {
      const result = toSchema(
        await deriveExpressionFromCode(
          `
            export interface UIMessage { id: string; }
            const messages = [] satisfies UIMessage[];
            export const payload = { data: { messages } };
          `,
          'payload',
          { UIMessage: '#/components/schemas/JsonObject' },
        ),
      );

      assert.deepStrictEqual(result.properties.data.properties.messages, {
        type: 'array',
        items: { $ref: '#/components/schemas/JsonObject' },
      });
    });

    test('keeps explicit types for shorthand empty arrays', async () => {
      const result = toSchema(
        await deriveExpressionFromCode(
          `
            export interface UIMessage { id: string; }
            const messages: UIMessage[] = [];
            export const payload = { messages };
          `,
          'payload',
          { UIMessage: '#/components/schemas/JsonObject' },
        ),
      );

      assert.deepStrictEqual(result.properties.messages, {
        type: 'array',
        items: { $ref: '#/components/schemas/JsonObject' },
      });
    });

    test('uses the current type of mutable shorthand variables', async () => {
      const result = toSchema(
        await deriveExpressionFromCode(
          `
            let status = 'ok';
            status = 'error';
            export const payload = { status };
          `,
          'payload',
        ),
      );

      assert.deepStrictEqual(result.properties.status, { type: 'string' });
    });

    test('uses the current type of mutable shorthand satisfies variables', async () => {
      const result = toSchema(
        await deriveExpressionFromCode(
          `
            let status = 'ok' satisfies string;
            status = 'error';
            export const payload = { status };
          `,
          'payload',
        ),
      );

      assert.deepStrictEqual(result.properties.status, { type: 'string' });
    });

    test('keeps explicit types on shorthand satisfies variables', async () => {
      const result = toSchema(
        await deriveExpressionFromCode(
          `
            const status: string = 'ok' satisfies string;
            export const payload = { status };
          `,
          'payload',
        ),
      );

      assert.deepStrictEqual(result.properties.status, { type: 'string' });
    });

    test('derives satisfies expressions through parentheses', async () => {
      const code = `
        export interface ChatShare { id: string; token: string; }
        export const payload = { shares: ([] satisfies ChatShare[]) };
      `;

      const result = await deriveExpressionFromCode(code, 'payload', {
        ChatShare: '#/components/schemas/ChatShare',
      });

      assert.deepStrictEqual(result.shares, {
        [deriveSymbol]: true,
        kind: 'array',
        optional: false,
        [$types]: ['#/components/schemas/ChatShare'],
      });
    });

    test('derives parenthesized satisfies expressions returned directly', async () => {
      const result = toSchema(
        await deriveExpressionFromCode(
          `
            export interface ChatShare { id: string; token: string; }
            export const payload = ([] satisfies ChatShare[]);
          `,
          'payload',
          { ChatShare: '#/components/schemas/ChatShare' },
        ),
      );

      assert.deepStrictEqual(result, {
        type: 'array',
        items: { $ref: '#/components/schemas/ChatShare' },
      });
    });

    test('keeps the narrowed type when satisfies has a real operand', async () => {
      const code = `
        export interface Flags { enabled: boolean; }
        export const flags = { enabled: true } satisfies Flags;
      `;

      const result = toSchema(await deriveExpressionFromCode(code, 'flags'));

      assert.deepStrictEqual(result, {
        type: 'object',
        properties: {
          enabled: { enum: [true], type: 'boolean' },
        },
        required: ['enabled'],
        additionalProperties: false,
      });
    });
  });
});
