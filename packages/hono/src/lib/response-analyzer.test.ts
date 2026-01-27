import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import ts from 'typescript';

import { $types, TypeDeriver, deriveSymbol } from '@sdk-it/core';
import { defaultResponseAnalyzer, newResponse } from '@sdk-it/hono';

async function createTestProject(code: string) {
  const testDir = await mkdtemp(join(tmpdir(), 'hono-response-test-'));
  const filePath = join(testDir, 'route.ts');

  await writeFile(filePath, code);

  const program = ts.createProgram([filePath], {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    strict: true,
    skipLibCheck: true,
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

function findHandlerInRoute(
  sourceFile: ts.SourceFile,
): ts.ArrowFunction | ts.FunctionExpression | undefined {
  let handler: ts.ArrowFunction | ts.FunctionExpression | undefined;

  function visit(node: ts.Node) {
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
      if (node.parameters.length > 0) {
        const firstParam = node.parameters[0];
        if (firstParam.name.getText() === 'c') {
          handler = node;
          return;
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return handler;
}

function findNewResponseExpression(
  sourceFile: ts.SourceFile,
): ts.NewExpression | undefined {
  let responseNode: ts.NewExpression | undefined;

  function visit(node: ts.Node) {
    if (ts.isReturnStatement(node) && node.expression) {
      if (ts.isNewExpression(node.expression)) {
        const exprName = node.expression.expression.getText();
        if (exprName === 'Response') {
          responseNode = node.expression;
          return;
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return responseNode;
}

async function analyzeHandler(handlerCode: string) {
  const code = `
    const handler = ${handlerCode};
  `;
  const { checker, sourceFile, cleanup } = await createTestProject(code);

  try {
    const handler = findHandlerInRoute(sourceFile);
    if (!handler) throw new Error('Handler not found');

    const deriver = new TypeDeriver(checker);
    return defaultResponseAnalyzer(handler, deriver);
  } finally {
    await cleanup();
  }
}

async function analyzeNewResponse(handlerCode: string) {
  const code = `
    const handler = ${handlerCode};
  `;
  const { checker, sourceFile, cleanup } = await createTestProject(code);

  try {
    const handler = findHandlerInRoute(sourceFile);
    if (!handler) throw new Error('Handler not found');

    const node = findNewResponseExpression(sourceFile);
    if (!node) throw new Error('Response constructor not found');

    const deriver = new TypeDeriver(checker);
    return newResponse(handler, deriver, node);
  } finally {
    await cleanup();
  }
}

describe('Response Analyzer', () => {
  describe('defaultResponseAnalyzer', () => {
    describe('c.json() returns', () => {
      test('extracts 200 status from c.json(data)', async () => {
        const responses = await analyzeHandler(`
          async (c: any) => {
            const items = [{ id: 1, name: 'test' }];
            return c.json({ data: items });
          }
        `);

        assert.deepStrictEqual(responses, [
          {
            headers: [],
            contentType: 'application/json',
            statusCode: '200',
            response: {
              data: {
                [deriveSymbol]: true,
                [$types]: [
                  {
                    id: {
                      [deriveSymbol]: true,
                      [$types]: ['number'],
                      optional: false,
                      kind: 'literal',
                      value: 1,
                    },
                    name: {
                      [deriveSymbol]: true,
                      [$types]: ['string'],
                      optional: false,
                      kind: 'literal',
                      value: 'test',
                    },
                  },
                ],
                kind: 'array',
              },
            },
          },
        ]);
      });
      test('extracts explicit status from c.json(data, 201)', async () => {
        const responses = await analyzeHandler(`
          (c: any) => {
            return c.json({ created: true }, 201);
          }
        `);

        assert.deepStrictEqual(responses, [
          {
            headers: [],
            contentType: 'application/json',
            statusCode: '201',
            response: {
              created: {
                [deriveSymbol]: true,
                [$types]: ['boolean'],
                optional: false,
                kind: 'literal',
                value: true,
              },
            },
          },
        ]);
      });
      test('extracts headers from c.json(data, status, headers)', async () => {
        const responses = await analyzeHandler(`
          (c: any) => {
            return c.json({ data: 'test' }, 200, { 'X-Custom': 'value' });
          }
        `);

        assert.deepStrictEqual(responses, [
          {
            headers: ["'X-Custom'", 'X-Custom'],
            contentType: 'application/json',
            statusCode: '200',
            response: {
              data: {
                [deriveSymbol]: true,
                [$types]: ['string'],
                optional: false,
                kind: 'literal',
                value: 'test',
              },
            },
          },
        ]);
      });

      test('extracts response object with multiple fields', async () => {
        const responses = await analyzeHandler(`
          (c: any) => {
            return c.json({ id: 1, name: 'test' });
          }
        `);

        assert.deepStrictEqual(responses, [
          {
            headers: [],
            contentType: 'application/json',
            statusCode: '200',
            response: {
              id: {
                [deriveSymbol]: true,
                [$types]: ['number'],
                optional: false,
                kind: 'literal',
                value: 1,
              },
              name: {
                [deriveSymbol]: true,
                [$types]: ['string'],
                optional: false,
                kind: 'literal',
                value: 'test',
              },
            },
          },
        ]);
      });
    });

    describe('c.body() returns', () => {
      test('extracts application/octet-stream for c.body()', async () => {
        const responses = await analyzeHandler(`
          (c: any) => {
            return c.body('binary data');
          }
        `);

        assert.deepStrictEqual(responses, [
          {
            headers: [],
            contentType: 'application/octet-stream',
            statusCode: '200',
            response: {
              [deriveSymbol]: true,
              [$types]: ['string'],
              optional: false,
              kind: 'literal',
              value: 'binary data',
            },
          },
        ]);
      });

      test('uses Content-Type header hint for c.body()', async () => {
        const responses = await analyzeHandler(`
          (c: any) => {
            const pdfBuffer = new Uint8Array();
            return c.body(pdfBuffer, 200, { 'Content-Type': 'application/pdf' });
          }
        `);

        assert.deepStrictEqual(responses, [
          {
            headers: ["'Content-Type'", 'Content-Type'],
            contentType: 'application/pdf',
            statusCode: '200',
            response: {
              [deriveSymbol]: true,
              [$types]: ['any'],
              optional: false,
            },
          },
        ]);
      });

      test('resolves const Content-Type value', async () => {
        const responses = await analyzeHandler(`
          (c: any) => {
            const contentType = 'application/pdf' as const;
            const pdfBuffer = new Uint8Array();
            return c.body(pdfBuffer, 200, { 'Content-Type': contentType });
          }
        `);

        assert.deepStrictEqual(responses, [
          {
            headers: ["'Content-Type'", 'Content-Type'],
            contentType: 'application/pdf',
            statusCode: '200',
            response: {
              [deriveSymbol]: true,
              [$types]: ['any'],
              optional: false,
            },
          },
        ]);
      });

      test('resolves enum Content-Type value', async () => {
        const responses = await analyzeHandler(`
          (() => {
            enum ContentType {
              Pdf = 'application/pdf',
            }
            return (c: any) => {
              const pdfBuffer = new Uint8Array();
              return c.body(pdfBuffer, 200, { 'Content-Type': ContentType.Pdf });
            };
          })()
        `);

        assert.deepStrictEqual(responses, [
          {
            headers: ["'Content-Type'", 'Content-Type'],
            contentType: 'application/pdf',
            statusCode: '200',
            response: {
              [deriveSymbol]: true,
              [$types]: ['any'],
              optional: false,
            },
          },
        ]);
      });

      test('resolves const enum Content-Type value', async () => {
        const responses = await analyzeHandler(`
          (() => {
            const enum ContentType {
              Pdf = 'application/pdf',
            }
            return (c: any) => {
              const pdfBuffer = new Uint8Array();
              return c.body(pdfBuffer, 200, { 'Content-Type': ContentType.Pdf });
            };
          })()
        `);

        assert.deepStrictEqual(responses, [
          {
            headers: ["'Content-Type'", 'Content-Type'],
            contentType: 'application/pdf',
            statusCode: '200',
            response: {
              [deriveSymbol]: true,
              [$types]: ['any'],
              optional: false,
            },
          },
        ]);
      });

      test('resolves Content-Type from enum element access', async () => {
        const responses = await analyzeHandler(`
          (() => {
            enum ContentType {
              Pdf = 'application/pdf',
            }
            return (c: any) => {
              const pdfBuffer = new Uint8Array();
              return c.body(pdfBuffer, 200, {
                'Content-Type': ContentType['Pdf'],
              });
            };
          })()
        `);

        assert.deepStrictEqual(responses, [
          {
            headers: ["'Content-Type'", 'Content-Type'],
            contentType: 'application/pdf',
            statusCode: '200',
            response: {
              [deriveSymbol]: true,
              [$types]: ['any'],
              optional: false,
            },
          },
        ]);
      });

      test('resolves Content-Type from computed property name', async () => {
        const responses = await analyzeHandler(`
          (c: any) => {
            const pdfBuffer = new Uint8Array();
            return c.body(pdfBuffer, 200, { ['Content-Type']: 'application/pdf' });
          }
        `);

        assert.deepStrictEqual(responses, [
          {
            headers: ["['Content-Type']", 'Content-Type'],
            contentType: 'application/pdf',
            statusCode: '200',
            response: {
              [deriveSymbol]: true,
              [$types]: ['any'],
              optional: false,
            },
          },
        ]);
      });

      test('resolves Content-Type from computed property name variable', async () => {
        const responses = await analyzeHandler(`
          (c: any) => {
            const headerName = 'Content-Type' as const;
            const pdfBuffer = new Uint8Array();
            return c.body(pdfBuffer, 200, { [headerName]: 'application/pdf' });
          }
        `);

        assert.deepStrictEqual(responses, [
          {
            headers: ['[headerName]', 'Content-Type'],
            contentType: 'application/pdf',
            statusCode: '200',
            response: {
              [deriveSymbol]: true,
              [$types]: ['any'],
              optional: false,
            },
          },
        ]);
      });

      test('does not resolve unioned Content-Type with different values', async () => {
        const responses = await analyzeHandler(`
          (c: any) => {
            let ct: 'application/pdf' | 'application/json';
            if (Math.random() > 0.5) {
              ct = 'application/pdf';
            } else {
              ct = 'application/json';
            }
            const pdfBuffer = new Uint8Array();
            return c.body(pdfBuffer, 200, { 'Content-Type': ct });
          }
        `);

        assert.deepStrictEqual(responses, [
          {
            headers: ["'Content-Type'", 'Content-Type'],
            contentType: 'application/octet-stream',
            statusCode: '200',
            response: {
              [deriveSymbol]: true,
              [$types]: ['any'],
              optional: false,
            },
          },
        ]);
      });

      test('resolves union after narrowing', async () => {
        const responses = await analyzeHandler(`
          (c: any) => {
            const ct: 'application/pdf' | 'application/json' = Math.random() > 0.5
              ? 'application/pdf'
              : 'application/json';
            const pdfBuffer = new Uint8Array();
            if (ct === 'application/pdf') {
              return c.body(pdfBuffer, 200, { 'Content-Type': ct });
            }
            return c.body(pdfBuffer, 200, { 'Content-Type': ct });
          }
        `);

        assert.deepStrictEqual(responses, [
          {
            headers: ["'Content-Type'", 'Content-Type'],
            contentType: 'application/pdf',
            statusCode: '200',
            response: {
              [deriveSymbol]: true,
              [$types]: ['any'],
              optional: false,
            },
          },
          {
            headers: ["'Content-Type'", 'Content-Type'],
            contentType: 'application/json',
            statusCode: '200',
            response: {
              [deriveSymbol]: true,
              [$types]: ['any'],
              optional: false,
            },
          },
        ]);
      });

      test('resolves Content-Type from helper function return', async () => {
        const responses = await analyzeHandler(`
          (c: any) => {
            const pdfBuffer = new Uint8Array();
            const headers = (() => ({ 'Content-Type': 'application/pdf' as const }))();
            return c.body(pdfBuffer, 200, headers);
          }
        `);

        assert.deepStrictEqual(responses, [
          {
            headers: ["'Content-Type'", 'Content-Type'],
            contentType: 'application/pdf',
            statusCode: '200',
            response: {
              [deriveSymbol]: true,
              [$types]: ['any'],
              optional: false,
            },
          },
        ]);
      });

      test('uses Content-Disposition hint with dynamic value', async () => {
        const responses = await analyzeHandler(`
          (c: any) => {
            const fileName = 'report';
            const pdfBuffer = new Uint8Array();
            return c.body(pdfBuffer, 200, {
              'Content-Disposition': \`attachment; filename="\${fileName}.pdf"\`,
            });
          }
        `);

        assert.deepStrictEqual(responses, [
          {
            headers: ["'Content-Disposition'", 'Content-Disposition'],
            contentType: 'application/octet-stream',
            statusCode: '200',
            response: {
              [deriveSymbol]: true,
              [$types]: ['any'],
              optional: false,
            },
          },
        ]);
      });

      test('extracts octet-stream content-type for c.body(null)', async () => {
        const responses = await analyzeHandler(`
          (c: any) => {
            return c.body(null, 204);
          }
        `);

        assert.deepStrictEqual(responses, [
          {
            headers: [],
            contentType: 'application/octet-stream',
            statusCode: '204',
            response: {
              [deriveSymbol]: true,
              [$types]: ['null'],
              optional: false,
            },
          },
        ]);
      });
    });

    describe('multiple return paths', () => {
      test('extracts all responses from conditional returns', async () => {
        const responses = await analyzeHandler(`
          (c: any) => {
            const found = true;
            if (!found) {
              return c.json({ error: 'not found' }, 404);
            }
            return c.json({ data: 'success' }, 200);
          }
        `);

        assert.deepStrictEqual(responses, [
          {
            headers: [],
            contentType: 'application/json',
            statusCode: '404',
            response: {
              error: {
                [deriveSymbol]: true,
                [$types]: ['string'],
                optional: false,
                kind: 'literal',
                value: 'not found',
              },
            },
          },
          {
            headers: [],
            contentType: 'application/json',
            statusCode: '200',
            response: {
              data: {
                [deriveSymbol]: true,
                [$types]: ['string'],
                optional: false,
                kind: 'literal',
                value: 'success',
              },
            },
          },
        ]);
      });
    });
  });

  describe('new Response() returns', () => {
    test('extracts headers, content type, and status', async () => {
      const responses = await analyzeNewResponse(`
        (c: any) => {
          const pdfBuffer = new Uint8Array();
          return new Response(pdfBuffer, {
            status: 200,
            headers: {
              'Content-Type': 'application/pdf',
              'Content-Disposition': 'inline; filename="report.pdf"',
            },
          });
        }
      `);

      assert.deepStrictEqual(responses, [
        {
          headers: [
            "'Content-Disposition'",
            "'Content-Type'",
            'Content-Disposition',
            'Content-Type',
          ],
          contentType: 'application/pdf',
          statusCode: '200',
          response: undefined,
        },
      ]);
    });

    test('uses Content-Disposition hint when Content-Type missing', async () => {
      const responses = await analyzeNewResponse(`
        (c: any) => {
          const pdfBuffer = new Uint8Array();
          const headers = {
            'Content-Disposition': 'attachment; filename="report.pdf"',
          };
          return new Response(pdfBuffer, {
            status: 200,
            headers,
          });
        }
      `);

      assert.deepStrictEqual(responses, [
        {
          headers: ["'Content-Disposition'", 'Content-Disposition'],
          contentType: 'application/octet-stream',
          statusCode: '200',
          response: undefined,
        },
      ]);
    });

    test('resolves Content-Type from new Headers()', async () => {
      const responses = await analyzeNewResponse(`
        (c: any) => {
          const contentType = 'application/pdf' as const;
          const pdfBuffer = new Uint8Array();
          return new Response(pdfBuffer, {
            status: 200,
            headers: new Headers({ 'Content-Type': contentType }),
          });
        }
      `);

      assert.deepStrictEqual(responses, [
        {
          headers: ["'Content-Type'", 'Content-Type'],
          contentType: 'application/pdf',
          statusCode: '200',
          response: undefined,
        },
      ]);
    });

    test('resolves Content-Type from headers identifier', async () => {
      const responses = await analyzeNewResponse(`
        (c: any) => {
          const contentType = 'application/pdf' as const;
          const pdfBuffer = new Uint8Array();
          const headers = { 'Content-Type': contentType } as const;
          return new Response(pdfBuffer, {
            status: 200,
            headers,
          });
        }
      `);

      assert.deepStrictEqual(responses, [
        {
          headers: ["'Content-Type'", 'Content-Type'],
          contentType: 'application/pdf',
          statusCode: '200',
          response: undefined,
        },
      ]);
    });

    test('resolves Content-Type from new Headers() identifier', async () => {
      const responses = await analyzeNewResponse(`
        (c: any) => {
          const contentType = 'application/pdf' as const;
          const pdfBuffer = new Uint8Array();
          const headers = new Headers({ 'Content-Type': contentType });
          return new Response(pdfBuffer, {
            status: 200,
            headers,
          });
        }
      `);

      assert.deepStrictEqual(responses, [
        {
          headers: ["'Content-Type'", 'Content-Type'],
          contentType: 'application/pdf',
          statusCode: '200',
          response: undefined,
        },
      ]);
    });

    test('resolves Content-Type from computed header name variable', async () => {
      const responses = await analyzeNewResponse(`
        (c: any) => {
          const headerName = 'Content-Type' as const;
          const pdfBuffer = new Uint8Array();
          const headers = { [headerName]: 'application/pdf' as const };
          return new Response(pdfBuffer, {
            status: 200,
            headers,
          });
        }
      `);

      assert.deepStrictEqual(responses, [
        {
          headers: ['[headerName]', 'Content-Type'],
          contentType: 'application/pdf',
          statusCode: '200',
          response: undefined,
        },
      ]);
    });

    test('resolves Content-Type from helper function headers', async () => {
      const responses = await analyzeNewResponse(`
        (c: any) => {
          const pdfBuffer = new Uint8Array();
          const headers = (() => ({ 'Content-Type': 'application/pdf' as const }))();
          return new Response(pdfBuffer, {
            status: 200,
            headers,
          });
        }
      `);

      assert.deepStrictEqual(responses, [
        {
          headers: ["'Content-Type'", 'Content-Type'],
          contentType: 'application/pdf',
          statusCode: '200',
          response: undefined,
        },
      ]);
    });
  });

  describe('httpException analyzer', () => {
    test.todo('extracts status code from HTTPException');
    test.todo('extracts response body from HTTPException options');
    test.todo('handles HTTPException with 409 conflict');
  });

  describe('real-world route patterns', () => {
    test.todo('extracts from GET route with c.json({ data })');
    test.todo('extracts from POST route with c.json(data, 201)');
    test.todo('extracts from route with HTTPException throw');
    test.todo('extracts from route with multiple return paths and throws');
  });

  describe('intersection types (allOf bug)', () => {
    test('properties from Omit & intersection should be required', async () => {
      const code = `
        type Base = {
          createdAt: string;
          updatedAt: string;
          mid: number;
          phoneNumber: string;
        };

        type Mapped = Omit<Base, 'mid'> & {
          id: string;
          userType: 'B2B';
        };

        function mapUser(input: Base): Mapped {
          return {
            createdAt: input.createdAt,
            updatedAt: input.updatedAt,
            phoneNumber: input.phoneNumber,
            id: 'some-id',
            userType: 'B2B',
          };
        }

        const handler = async (c: any) => {
          const user: Base = {
            createdAt: '2024-01-01',
            updatedAt: '2024-01-02',
            mid: 123,
            phoneNumber: '+1234567890',
          };
          return c.json(mapUser(user));
        };
      `;

      const { checker, sourceFile, cleanup } = await createTestProject(code);

      try {
        const handler = findHandlerInRoute(sourceFile);
        if (!handler) throw new Error('Handler not found');

        const deriver = new TypeDeriver(checker);
        const responses = defaultResponseAnalyzer(handler, deriver);

        assert.equal(responses.length, 1);
        const response = responses[0].response as unknown as Record<
          string | symbol,
          unknown
        >;

        assert.equal(response.kind, 'intersection');

        const { toSchema } = await import('@sdk-it/core');
        const openApiSchema = toSchema(response as any);

        assert.ok(openApiSchema.allOf, 'Should have allOf');
        assert.equal(openApiSchema.allOf.length, 2);

        const allRequired = openApiSchema.allOf.flatMap(
          (obj: any) => obj.required || [],
        );

        assert.ok(
          allRequired.includes('createdAt'),
          'createdAt should be required',
        );
        assert.ok(
          allRequired.includes('updatedAt'),
          'updatedAt should be required',
        );
        assert.ok(
          allRequired.includes('phoneNumber'),
          'phoneNumber should be required',
        );
        assert.ok(allRequired.includes('id'), 'id should be required');
        assert.ok(
          allRequired.includes('userType'),
          'userType should be required',
        );
      } finally {
        await cleanup();
      }
    });
  });
});
