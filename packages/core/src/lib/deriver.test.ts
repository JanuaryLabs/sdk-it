import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import ts from 'typescript';

import { $types, TypeDeriver, deriveSymbol } from '@sdk-it/core';

async function createTestProject(code: string) {
  const testDir = await mkdtemp(join(tmpdir(), 'ts-deriver-test-'));
  const filePath = join(testDir, 'main.ts');

  await writeFile(filePath, code);

  const program = ts.createProgram([filePath], {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    strict: true,
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
    test.todo('handles Record type');
  });

  describe('Unions & Intersections', () => {
    test.todo('collapses unions correctly');
    test.todo('handles optional via union with undefined');
    test.todo('handles intersection types');
    test.todo('handles discriminated unions');
  });

  describe('Type Mappings', () => {
    test.todo('uses default typesMap for built-in types');
    test.todo('uses custom typesMap');
  });

  describe('AST Node Serialization', () => {
    test.todo('handles typeof expressions');
    test.todo('handles const assertions');
  });
});
