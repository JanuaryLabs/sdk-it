import { type Context, Hono } from 'hono';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { openAnalysisProject } from '@sdk-it/core/program.js';
import { analyze } from '@sdk-it/generic';
import { responseAnalyzer } from '@sdk-it/hono';
import { analysisWorkspace } from '@sdk-it/testing';

/** Analyzes `route.ts` with the Hono analyzer and returns its paths as consumers write them to openapi.json. */
async function documentedPaths(route: string) {
  await using workspace = await analysisWorkspace('hono-response-analyzer-', {
    'route.ts': route,
  });
  using project = openAnalysisProject(workspace.tsconfig);
  const { paths } = await analyze(project, { responseAnalyzer });
  return JSON.parse(JSON.stringify(paths));
}

describe('Response Analyzer', () => {
  describe('defaultResponseAnalyzer', () => {
    describe('c.json() returns', () => {
      test('documents Date responses as date-time strings', async () => {
        const handler = (c: Context) => {
          const createdAt = new Date('2026-09-06T00:00:00Z');
          return c.json({ createdAt, history: [createdAt] });
        };
        const app = new Hono().get('/', handler);
        const response = await app.request('/');
        assert.deepStrictEqual(await response.json(), {
          createdAt: '2026-09-06T00:00:00.000Z',
          history: ['2026-09-06T00:00:00.000Z'],
        });

        const paths = await documentedPaths(`import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
app.get('/history', validate(() => ({})), ${handler.toString()});
`);

        assert.deepStrictEqual(paths['/history'].get.responses['200'], {
          description: 'Response for 200',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  createdAt: { type: 'string', format: 'date-time' },
                  history: {
                    type: 'array',
                    items: { type: 'string', format: 'date-time' },
                  },
                },
                required: ['createdAt', 'history'],
                additionalProperties: false,
              },
            },
          },
        });
      });

      test('documents a Date constructed directly in c.json()', async () => {
        const handler = (c: Context) => {
          return c.json(new Date('2026-09-06T00:00:00Z'));
        };
        const response = await new Hono().get('/', handler).request('/');
        assert.strictEqual(await response.json(), '2026-09-06T00:00:00.000Z');

        const paths = await documentedPaths(`import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
app.get('/now', validate(() => ({})), ${handler.toString()});
`);

        assert.deepStrictEqual(
          paths['/now'].get.responses['200'].content['application/json'].schema,
          { type: 'string', format: 'date-time' },
        );
      });

      test('extracts 200 status from c.json(data)', async () => {
        const paths = await documentedPaths(`import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
app.get('/items', validate(() => ({})), async (c) => {
  const items = [{ id: 1, name: 'test' }];
  return c.json({ data: items });
});
`);

        const { responses } = paths['/items'].get;
        assert.deepStrictEqual(Object.keys(responses).sort(), [
          '200',
          '400',
          '415',
        ]);
        assert.deepStrictEqual(responses['200'], {
          description: 'Response for 200',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  data: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        id: { type: 'number' },
                        name: { type: 'string' },
                      },
                      required: ['id', 'name'],
                      additionalProperties: false,
                    },
                  },
                },
                required: ['data'],
                additionalProperties: false,
              },
            },
          },
        });
      });

      test('extracts explicit status from c.json(data, 201)', async () => {
        const paths = await documentedPaths(`import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
app.post('/items', validate(() => ({})), (c) => {
  return c.json({ created: true }, 201);
});
`);

        const { responses } = paths['/items'].post;
        assert.deepStrictEqual(Object.keys(responses).sort(), [
          '201',
          '400',
          '415',
        ]);
        assert.deepStrictEqual(responses['201'], {
          description: 'Response for 201',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { created: { type: 'boolean', enum: [true] } },
                required: ['created'],
                additionalProperties: false,
              },
            },
          },
        });
      });

      test('extracts headers from c.json(data, status, headers)', async () => {
        const paths = await documentedPaths(`import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
app.get('/items', validate(() => ({})), (c) => {
  return c.json({ data: 'test' }, 200, { 'X-Custom': 'value' });
});
`);

        const { responses } = paths['/items'].get;
        assert.deepStrictEqual(Object.keys(responses).sort(), [
          '200',
          '400',
          '415',
        ]);
        assert.deepStrictEqual(responses['200'], {
          description: 'Response for 200',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { data: { type: 'string', enum: ['test'] } },
                required: ['data'],
                additionalProperties: false,
              },
            },
          },
          headers: {
            'X-Custom': { schema: { type: 'string' } },
          },
        });
      });

      test('documents c.json with a Content-Disposition header as application/json, as Hono sends it', async () => {
        const paths = await documentedPaths(`import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
app.get('/export', validate(() => ({})), (c) => {
  return c.json({ id: 1 }, 200, {
    'Content-Disposition': 'attachment; filename="export.json"',
  });
});
`);

        assert.deepStrictEqual(paths['/export'].get.responses['200'], {
          description: 'Response for 200',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { id: { type: 'number', enum: [1] } },
                required: ['id'],
                additionalProperties: false,
              },
            },
          },
          headers: {
            'Content-Disposition': { schema: { type: 'string' } },
          },
        });
      });

      test('extracts response object with multiple fields', async () => {
        const paths = await documentedPaths(`import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
app.get('/items', validate(() => ({})), (c) => {
  return c.json({ id: 1, name: 'test' });
});
`);

        const { responses } = paths['/items'].get;
        assert.deepStrictEqual(Object.keys(responses).sort(), [
          '200',
          '400',
          '415',
        ]);
        assert.deepStrictEqual(responses['200'], {
          description: 'Response for 200',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  id: { type: 'number', enum: [1] },
                  name: { type: 'string', enum: ['test'] },
                },
                required: ['id', 'name'],
                additionalProperties: false,
              },
            },
          },
        });
      });

      test("documents an array item's 'as const' discriminator as its literal through map, spread and rest", async () => {
        const paths = await documentedPaths(`import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
const prebuilt = [{ id: 'support', agents: ['a'] }];
declare const published: () => { id: string; agents: string[] }[];
app.get('/templates', validate(() => ({})), (c) => {
  const templates = [
    ...prebuilt.map((template) => ({ ...template, source: 'prebuilt' as const })),
    ...published().map(({ id, agents }) => ({ id, agents, source: 'marketplace' as const })),
  ];
  return c.json({
    templates: templates.map(({ agents, ...template }) => ({ ...template, agentCount: agents.length })),
  });
});
`);

        const template = (source: string) => ({
          type: 'object',
          properties: {
            agentCount: { type: 'number' },
            id: { type: 'string' },
            source: { type: 'string', enum: [source] },
          },
          required: ['agentCount', 'id', 'source'],
          additionalProperties: false,
        });
        assert.deepStrictEqual(
          paths['/templates'].get.responses['200'].content['application/json']
            .schema.properties.templates,
          {
            type: 'array',
            items: {
              anyOf: [template('prebuilt'), template('marketplace')],
            },
          },
        );
      });
    });

    describe('c.text(), c.html() and c.redirect() returns', () => {
      test('documents c.text with the text/plain media type Hono sends', async () => {
        const handler = (c: Context) => c.text('pong', 200);
        const response = await new Hono().get('/', handler).request('/');
        assert.equal(
          response.headers.get('Content-Type'),
          'text/plain; charset=UTF-8',
        );

        const paths =
          await documentedPaths(`import { Hono, type Context } from 'hono';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
app.get('/ping', validate(() => ({})), ${handler.toString()});
`);

        assert.deepStrictEqual(paths['/ping'].get.responses['200'], {
          description: 'Response for 200',
          content: {
            'text/plain': { schema: { type: 'string', enum: ['pong'] } },
          },
        });
      });

      test('documents c.html with the text/html media type Hono sends', async () => {
        const handler = (c: Context) => c.html('<p>hi</p>');
        const response = await new Hono().get('/', handler).request('/');
        assert.equal(
          response.headers.get('Content-Type'),
          'text/html; charset=UTF-8',
        );

        const paths =
          await documentedPaths(`import { Hono, type Context } from 'hono';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
app.get('/page', validate(() => ({})), ${handler.toString()});
`);

        assert.deepStrictEqual(paths['/page'].get.responses['200'], {
          description: 'Response for 200',
          content: {
            'text/html': { schema: { type: 'string', enum: ['<p>hi</p>'] } },
          },
        });
      });

      test('documents c.newResponse(null, 204) as a response with no body, as Hono sends it', async () => {
        const handler = (c: Context) => c.newResponse(null, 204);
        const response = await new Hono().get('/', handler).request('/');
        assert.equal(response.status, 204);
        assert.equal(response.headers.get('Content-Type'), null);

        const paths =
          await documentedPaths(`import { Hono, type Context } from 'hono';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
app.delete('/runs', validate(() => ({})), ${handler.toString()});
`);

        assert.deepStrictEqual(paths['/runs'].delete.responses['204'], {
          description: 'Response for 204',
        });
      });

      test('documents c.redirect as a 302 with a Location header and no body, as Hono sends it', async () => {
        const handler = (c: Context) => c.redirect('/runs');
        const response = await new Hono().get('/', handler).request('/');
        assert.equal(response.status, 302);
        assert.equal(response.headers.get('Location'), '/runs');
        assert.equal(await response.text(), '');

        const paths =
          await documentedPaths(`import { Hono, type Context } from 'hono';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
app.get('/old-runs', validate(() => ({})), ${handler.toString()});
`);

        const { responses } = paths['/old-runs'].get;
        assert.deepStrictEqual(Object.keys(responses).sort(), [
          '302',
          '400',
          '415',
        ]);
        assert.deepStrictEqual(responses['302'], {
          description: 'Response for 302',
          headers: { Location: { schema: { type: 'string' } } },
        });
      });

      test('documents c.redirect with the status it passes', async () => {
        const handler = (c: Context) => c.redirect('/runs', 301);

        const paths =
          await documentedPaths(`import { Hono, type Context } from 'hono';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
app.get('/old-runs', validate(() => ({})), ${handler.toString()});
`);

        assert.deepStrictEqual(paths['/old-runs'].get.responses['301'], {
          description: 'Response for 301',
          headers: { Location: { schema: { type: 'string' } } },
        });
      });
    });

    describe('c.body() returns', () => {
      test('extracts application/octet-stream for c.body()', async () => {
        const paths = await documentedPaths(`import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
app.get('/download', validate(() => ({})), (c) => {
  return c.body('binary data');
});
`);

        const { responses } = paths['/download'].get;
        assert.deepStrictEqual(Object.keys(responses).sort(), [
          '200',
          '400',
          '415',
        ]);
        assert.deepStrictEqual(responses['200'], {
          description: 'Response for 200',
          content: {
            'application/octet-stream': {
              schema: { type: 'string', format: 'binary' },
            },
          },
        });
      });

      test('uses Content-Type header hint for c.body()', async () => {
        const paths = await documentedPaths(`import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
app.get('/report', validate(() => ({})), (c) => {
  const pdfBuffer = new Uint8Array();
  return c.body(pdfBuffer, 200, { 'Content-Type': 'application/pdf' });
});
`);

        const { responses } = paths['/report'].get;
        assert.deepStrictEqual(Object.keys(responses).sort(), [
          '200',
          '400',
          '415',
        ]);
        assert.deepStrictEqual(responses['200'], {
          description: 'Response for 200',
          content: { 'application/pdf': { schema: {} } },
        });
      });

      test('resolves const Content-Type value', async () => {
        const paths = await documentedPaths(`import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
app.get('/report', validate(() => ({})), (c) => {
  const contentType = 'application/pdf' as const;
  const pdfBuffer = new Uint8Array();
  return c.body(pdfBuffer, 200, { 'Content-Type': contentType });
});
`);

        assert.deepStrictEqual(paths['/report'].get.responses['200'], {
          description: 'Response for 200',
          content: { 'application/pdf': { schema: {} } },
        });
      });

      test('resolves enum Content-Type value', async () => {
        const paths = await documentedPaths(`import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
enum ContentType {
  Pdf = 'application/pdf',
}
app.get('/report', validate(() => ({})), (c) => {
  const pdfBuffer = new Uint8Array();
  return c.body(pdfBuffer, 200, { 'Content-Type': ContentType.Pdf });
});
`);

        assert.deepStrictEqual(paths['/report'].get.responses['200'], {
          description: 'Response for 200',
          content: { 'application/pdf': { schema: {} } },
        });
      });

      test('resolves const enum Content-Type value', async () => {
        const paths = await documentedPaths(`import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
const enum ContentType {
  Pdf = 'application/pdf',
}
app.get('/report', validate(() => ({})), (c) => {
  const pdfBuffer = new Uint8Array();
  return c.body(pdfBuffer, 200, { 'Content-Type': ContentType.Pdf });
});
`);

        assert.deepStrictEqual(paths['/report'].get.responses['200'], {
          description: 'Response for 200',
          content: { 'application/pdf': { schema: {} } },
        });
      });

      test('resolves Content-Type from enum element access', async () => {
        const paths = await documentedPaths(`import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
enum ContentType {
  Pdf = 'application/pdf',
}
app.get('/report', validate(() => ({})), (c) => {
  const pdfBuffer = new Uint8Array();
  return c.body(pdfBuffer, 200, {
    'Content-Type': ContentType['Pdf'],
  });
});
`);

        assert.deepStrictEqual(paths['/report'].get.responses['200'], {
          description: 'Response for 200',
          content: { 'application/pdf': { schema: {} } },
        });
      });

      test('resolves Content-Type from computed property name', async () => {
        const paths = await documentedPaths(`import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
app.get('/report', validate(() => ({})), (c) => {
  const pdfBuffer = new Uint8Array();
  return c.body(pdfBuffer, 200, { ['Content-Type']: 'application/pdf' });
});
`);

        assert.deepStrictEqual(paths['/report'].get.responses['200'], {
          description: 'Response for 200',
          content: { 'application/pdf': { schema: {} } },
        });
      });

      test('resolves Content-Type from computed property name variable', async () => {
        const paths = await documentedPaths(`import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
app.get('/report', validate(() => ({})), (c) => {
  const headerName = 'Content-Type' as const;
  const pdfBuffer = new Uint8Array();
  return c.body(pdfBuffer, 200, { [headerName]: 'application/pdf' });
});
`);

        assert.deepStrictEqual(paths['/report'].get.responses['200'], {
          description: 'Response for 200',
          content: { 'application/pdf': { schema: {} } },
        });
      });

      test('does not resolve unioned Content-Type with different values', async () => {
        const paths = await documentedPaths(`import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
app.get('/report', validate(() => ({})), (c) => {
  let ct: 'application/pdf' | 'application/json';
  if (Math.random() > 0.5) {
    ct = 'application/pdf';
  } else {
    ct = 'application/json';
  }
  const pdfBuffer = new Uint8Array();
  return c.body(pdfBuffer, 200, { 'Content-Type': ct });
});
`);

        assert.deepStrictEqual(paths['/report'].get.responses['200'], {
          description: 'Response for 200',
          content: {
            'application/octet-stream': {
              schema: { type: 'string', format: 'binary' },
            },
          },
        });
      });

      test('resolves union after narrowing', async () => {
        const paths = await documentedPaths(`import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
app.get('/report', validate(() => ({})), (c) => {
  const ct: 'application/pdf' | 'application/json' = Math.random() > 0.5
    ? 'application/pdf'
    : 'application/json';
  const pdfBuffer = new Uint8Array();
  if (ct === 'application/pdf') {
    return c.body(pdfBuffer, 200, { 'Content-Type': ct });
  }
  return c.body(pdfBuffer, 200, { 'Content-Type': ct });
});
`);

        const response = paths['/report'].get.responses['200'];
        assert.deepStrictEqual(Object.keys(response.content), [
          'application/pdf',
          'application/json',
        ]);
        assert.deepStrictEqual(response, {
          description: 'Response for 200',
          content: {
            'application/pdf': { schema: {} },
            'application/json': { schema: {} },
          },
        });
      });

      test('resolves Content-Type from helper function return', async () => {
        const paths = await documentedPaths(`import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
app.get('/report', validate(() => ({})), (c) => {
  const pdfBuffer = new Uint8Array();
  const headers = (() => ({ 'Content-Type': 'application/pdf' as const }))();
  return c.body(pdfBuffer, 200, headers);
});
`);

        assert.deepStrictEqual(paths['/report'].get.responses['200'], {
          description: 'Response for 200',
          content: { 'application/pdf': { schema: {} } },
        });
      });

      test('uses Content-Disposition hint with dynamic value', async () => {
        const paths = await documentedPaths(`import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
app.get('/report', validate(() => ({})), (c) => {
  const fileName = 'report';
  const pdfBuffer = new Uint8Array();
  return c.body(pdfBuffer, 200, {
    'Content-Disposition': \`attachment; filename="\${fileName}.pdf"\`,
  });
});
`);

        assert.deepStrictEqual(paths['/report'].get.responses['200'], {
          description: 'Response for 200',
          content: {
            'application/octet-stream': {
              schema: { type: 'string', format: 'binary' },
            },
          },
          headers: {
            'Content-Disposition': { schema: { type: 'string' } },
          },
        });
      });

      test('c.body(null) sends no body', async () => {
        const paths = await documentedPaths(`import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
app.delete('/items', validate(() => ({})), (c) => {
  return c.body(null, 204);
});
`);

        const { responses } = paths['/items'].delete;
        assert.deepStrictEqual(Object.keys(responses).sort(), [
          '204',
          '400',
          '415',
        ]);
        assert.deepStrictEqual(responses['204'], {
          description: 'Response for 204',
        });
      });
    });

    describe('multiple return paths', () => {
      test('extracts all responses from conditional returns', async () => {
        const paths = await documentedPaths(`import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
app.get('/items', validate(() => ({})), (c) => {
  const found = true;
  if (!found) {
    return c.json({ error: 'not found' }, 404);
  }
  return c.json({ data: 'success' }, 200);
});
`);

        const { responses } = paths['/items'].get;
        assert.deepStrictEqual(Object.keys(responses).sort(), [
          '200',
          '400',
          '404',
          '415',
        ]);
        assert.deepStrictEqual(responses['404'], {
          description: 'Response for 404',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { error: { type: 'string', enum: ['not found'] } },
                required: ['error'],
                additionalProperties: false,
              },
            },
          },
        });
        assert.deepStrictEqual(responses['200'], {
          description: 'Response for 200',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { data: { type: 'string', enum: ['success'] } },
                required: ['data'],
                additionalProperties: false,
              },
            },
          },
        });
      });
    });
  });

  describe('new Response() returns', () => {
    test('extracts headers, content type, and status', async () => {
      const paths = await documentedPaths(`import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
app.get('/report', validate(() => ({})), (c) => {
  const pdfBuffer = new Uint8Array();
  return new Response(pdfBuffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="report.pdf"',
    },
  });
});
`);

      const { responses } = paths['/report'].get;
      assert.deepStrictEqual(Object.keys(responses).sort(), [
        '200',
        '400',
        '415',
      ]);
      assert.deepStrictEqual(responses['200'], {
        description: 'Response for 200',
        content: { 'application/pdf': { schema: {} } },
        headers: {
          'Content-Disposition': { schema: { type: 'string' } },
        },
      });
    });

    test('uses Content-Disposition hint when Content-Type missing', async () => {
      const paths = await documentedPaths(`import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
app.get('/report', validate(() => ({})), (c) => {
  const pdfBuffer = new Uint8Array();
  const headers = {
    'Content-Disposition': 'attachment; filename="report.pdf"',
  };
  return new Response(pdfBuffer, {
    status: 200,
    headers,
  });
});
`);

      assert.deepStrictEqual(paths['/report'].get.responses['200'], {
        description: 'Response for 200',
        content: {
          'application/octet-stream': {
            schema: { type: 'string', format: 'binary' },
          },
        },
        headers: {
          'Content-Disposition': { schema: { type: 'string' } },
        },
      });
    });

    test('resolves Content-Type from new Headers()', async () => {
      const paths = await documentedPaths(`import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
app.get('/report', validate(() => ({})), (c) => {
  const contentType = 'application/pdf' as const;
  const pdfBuffer = new Uint8Array();
  return new Response(pdfBuffer, {
    status: 200,
    headers: new Headers({ 'Content-Type': contentType }),
  });
});
`);

      assert.deepStrictEqual(paths['/report'].get.responses['200'], {
        description: 'Response for 200',
        content: { 'application/pdf': { schema: {} } },
      });
    });

    test('resolves Content-Type from headers identifier', async () => {
      const paths = await documentedPaths(`import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
app.get('/report', validate(() => ({})), (c) => {
  const contentType = 'application/pdf' as const;
  const pdfBuffer = new Uint8Array();
  const headers = { 'Content-Type': contentType } as const;
  return new Response(pdfBuffer, {
    status: 200,
    headers,
  });
});
`);

      assert.deepStrictEqual(paths['/report'].get.responses['200'], {
        description: 'Response for 200',
        content: { 'application/pdf': { schema: {} } },
      });
    });

    test('resolves Content-Type from new Headers() identifier', async () => {
      const paths = await documentedPaths(`import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
app.get('/report', validate(() => ({})), (c) => {
  const contentType = 'application/pdf' as const;
  const pdfBuffer = new Uint8Array();
  const headers = new Headers({ 'Content-Type': contentType });
  return new Response(pdfBuffer, {
    status: 200,
    headers,
  });
});
`);

      assert.deepStrictEqual(paths['/report'].get.responses['200'], {
        description: 'Response for 200',
        content: { 'application/pdf': { schema: {} } },
      });
    });

    test('resolves Content-Type from computed header name variable', async () => {
      const paths = await documentedPaths(`import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
app.get('/report', validate(() => ({})), (c) => {
  const headerName = 'Content-Type' as const;
  const pdfBuffer = new Uint8Array();
  const headers = { [headerName]: 'application/pdf' as const };
  return new Response(pdfBuffer, {
    status: 200,
    headers,
  });
});
`);

      assert.deepStrictEqual(paths['/report'].get.responses['200'], {
        description: 'Response for 200',
        content: { 'application/pdf': { schema: {} } },
      });
    });

    test('resolves Content-Type from helper function headers', async () => {
      const paths = await documentedPaths(`import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
app.get('/report', validate(() => ({})), (c) => {
  const pdfBuffer = new Uint8Array();
  const headers = (() => ({ 'Content-Type': 'application/pdf' as const }))();
  return new Response(pdfBuffer, {
    status: 200,
    headers,
  });
});
`);

      assert.deepStrictEqual(paths['/report'].get.responses['200'], {
        description: 'Response for 200',
        content: { 'application/pdf': { schema: {} } },
      });
    });

    test('new Response(null, { status: 204 }) sends no body', async () => {
      const paths = await documentedPaths(`import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
app.delete('/items', validate(() => ({})), (c) => {
  return new Response(null, { status: 204 });
});
`);

      const { responses } = paths['/items'].delete;
      assert.deepStrictEqual(Object.keys(responses).sort(), [
        '204',
        '400',
        '415',
      ]);
      assert.deepStrictEqual(responses['204'], {
        description: 'Response for 204',
      });
    });

    test('new Response(null) sends no body', async () => {
      const paths = await documentedPaths(`import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
app.post('/ping', validate(() => ({})), (c) => {
  return new Response(null);
});
`);

      const { responses } = paths['/ping'].post;
      assert.deepStrictEqual(Object.keys(responses).sort(), [
        '200',
        '400',
        '415',
      ]);
      assert.deepStrictEqual(responses['200'], {
        description: 'Response for 200',
      });
    });

    test('new Response(null, { status, headers }) sends no body and keeps its status and headers', async () => {
      const paths = await documentedPaths(`import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
app.get('/old-runs', validate(() => ({})), (c) => {
  return new Response(null, {
    status: 301,
    headers: { Location: '/runs' },
  });
});
`);

      const { responses } = paths['/old-runs'].get;
      assert.deepStrictEqual(Object.keys(responses).sort(), [
        '301',
        '400',
        '415',
      ]);
      assert.deepStrictEqual(responses['301'], {
        description: 'Response for 301',
        headers: { Location: { schema: { type: 'string' } } },
      });
    });
  });

  describe('httpException analyzer', () => {
    void test.todo('extracts status code from HTTPException');
    void test.todo('extracts response body from HTTPException options');
    void test.todo('handles HTTPException with 409 conflict');
  });

  describe('real-world route patterns', () => {
    void test.todo('extracts from GET route with c.json({ data })');
    void test.todo('extracts from POST route with c.json(data, 201)');
    void test.todo('extracts from route with HTTPException throw');
    void test.todo('extracts from route with multiple return paths and throws');
  });

  describe('streamSSE analyzer', () => {
    test('returns text/event-stream response', async () => {
      const paths = await documentedPaths(`import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
app.get('/events', validate(() => ({})), (c) => {
  return streamSSE(c, async (stream) => {
    await stream.writeSSE({ data: 'tick' });
  });
});
`);

      const { responses } = paths['/events'].get;
      assert.deepStrictEqual(Object.keys(responses).sort(), [
        '200',
        '400',
        '415',
      ]);
      assert.deepStrictEqual(responses['200'], {
        description: 'Response for 200',
        content: { 'text/event-stream': { schema: { type: 'string' } } },
      });
    });
  });

  describe('intersection types (allOf bug)', () => {
    test('properties from Omit & intersection should be required', async () => {
      const paths = await documentedPaths(`import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();

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

app.get('/user', validate(() => ({})), async (c) => {
  const user: Base = {
    createdAt: '2024-01-01',
    updatedAt: '2024-01-02',
    mid: 123,
    phoneNumber: '+1234567890',
  };
  return c.json(mapUser(user));
});
`);

      const { responses } = paths['/user'].get;
      assert.deepStrictEqual(Object.keys(responses).sort(), [
        '200',
        '400',
        '415',
      ]);
      const { schema } = responses['200'].content['application/json'];
      assert.ok(schema.allOf, 'Should have allOf');
      assert.equal(schema.allOf.length, 2);
      const allRequired = schema.allOf.flatMap(
        (part: { required?: string[] }) => part.required ?? [],
      );
      assert.deepStrictEqual(allRequired.toSorted(), [
        'createdAt',
        'id',
        'phoneNumber',
        'updatedAt',
        'userType',
      ]);
    });
  });
});

describe('status and Content-Type constant resolution', () => {
  test('rejects a status code that is not a numeric literal', async () => {
    await assert.rejects(
      documentedPaths(`import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
enum Status {
  Created = 201,
}
app.post('/items', validate(() => ({})), (c) => {
  return c.json({ id: 1 }, Status.Created);
});
`),
      /Could not resolve status code/,
    );
  });

  test('falls back to the method content type when Content-Type is not a constant', async () => {
    const paths = await documentedPaths(`import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
declare const contentType: string;
app.get('/export', validate(() => ({})), (c) => {
  return c.body('a,b', 200, { 'Content-Type': contentType });
});
`);

    const { responses } = paths['/export'].get;
    assert.deepStrictEqual(Object.keys(responses).sort(), [
      '200',
      '400',
      '415',
    ]);
    assert.deepStrictEqual(Object.keys(responses['200'].content), [
      'application/octet-stream',
    ]);
  });

  test('resolves a Content-Type union whose members share one value', async () => {
    const paths = await documentedPaths(`import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
enum ContentType {
  Csv = 'text/csv',
}
const preferEnum = Math.random() > 0.5;
app.get('/export', validate(() => ({})), (c) => {
  const contentType = preferEnum ? ContentType.Csv : 'text/csv';
  return c.body('a,b', 200, { 'Content-Type': contentType });
});
`);

    assert.deepStrictEqual(
      Object.keys(paths['/export'].get.responses['200'].content),
      ['text/csv'],
    );
  });

  test('falls back to the method content type when a Content-Type union has different values', async () => {
    const paths = await documentedPaths(`import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
const preferCsv = Math.random() > 0.5;
app.get('/export', validate(() => ({})), (c) => {
  const contentType = preferCsv ? 'text/csv' : 'application/pdf';
  return c.body('a,b', 200, { 'Content-Type': contentType });
});
`);

    assert.deepStrictEqual(
      Object.keys(paths['/export'].get.responses['200'].content),
      ['application/octet-stream'],
    );
  });

  test('falls back to the method content type when a Content-Type union includes a non-literal member', async () => {
    const paths = await documentedPaths(`import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
const format = Math.random() > 0.5 ? 'csv' : 'json';
app.get('/export', validate(() => ({})), (c) => {
  const contentType = format === 'csv' ? 'text/csv' : undefined;
  return c.body('a,b', 200, { 'Content-Type': contentType });
});
`);

    assert.deepStrictEqual(
      Object.keys(paths['/export'].get.responses['200'].content),
      ['application/octet-stream'],
    );
  });

  test('resolves a Content-Type written as a template literal without substitutions', async () => {
    const paths = await documentedPaths(`import { Hono } from 'hono';
import { validate } from '@sdk-it/hono/runtime';
export const app = new Hono();
app.get('/export', validate(() => ({})), (c) => {
  return c.body('a,b', 200, { 'Content-Type': \`text/csv\` });
});
`);

    assert.deepStrictEqual(
      Object.keys(paths['/export'].get.responses['200'].content),
      ['text/csv'],
    );
  });
});
