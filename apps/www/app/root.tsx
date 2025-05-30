import { Serverize } from '@serverize/client';
import rehypeShiki, { type RehypeShikiOptions } from '@shikijs/rehype';
import { transformerTwoslash } from '@shikijs/twoslash';
import type { OpenAPIObject } from 'openapi3-ts/oas31';
import {
  Links,
  type LinksFunction,
  Meta,
  type MetaFunction,
  Outlet,
  Scripts,
  ScrollRestoration,
} from 'react-router';
import rehypeStringify from 'rehype-stringify';
import rehypeTwoslash from 'rehype-twoslash';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';

import { createOperation } from '@sdk-it/spec';
import {
  type TunedOperationObject,
  augmentSpec,
  forEachOperation,
} from '@sdk-it/spec/operation.js';

import '../styles.css';
import { AppNav } from './app-nav';
import { Toaster, cn } from './shadcn';
import { useRootData } from './use-root-data';

export const meta: MetaFunction = () => [
  {
    title: 'New Nx React Router App',
  },
];

export const links: LinksFunction = () => [
  { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
  {
    rel: 'preconnect',
    href: 'https://fonts.gstatic.com',
    crossOrigin: 'anonymous',
  },
  {
    rel: 'stylesheet',
    href: `https://fonts.googleapis.com/css2?family=Geist:wght@300..700&display=swap`,
  },
  {
    rel: 'stylesheet',
    href: `https://fonts.googleapis.com/css2?family=Geist+Mono:wght@400..700&display=swap`,
  },
  {
    rel: 'stylesheet',
    href: `https://fonts.googleapis.com/css2?family=Rubik:ital,wght@0,300..900;1,300..900&display=swap`,
  },
];
export function Layout({ children }: { children: React.ReactNode }) {
  const { isDark } = useRootData();

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body className={cn('flex h-full flex-col', isDark ? 'dark' : '')}>
        <Toaster />
        <AppNav />
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export async function loader({ request }: { request: Request }) {
  const processor = unified()
    .use(remarkParse)
    .use(remarkRehype)
    .use(rehypeShiki, {
      transformers: [
        transformerTwoslash({
          explicitTrigger: true,

          twoslashOptions: {
            compilerOptions: {
              lib: ['DOM', 'DOM.Iterable', 'ESNext'],
            },
          },
        }),
      ],
      defaultColor: 'light',
      cssVariablePrefix: '--shiki-',
      themes: {
        light: 'min-light',
        dark: 'vesper',
      },
    } satisfies RehypeShikiOptions)
    .use(rehypeTwoslash)
    .use(rehypeStringify);

  const isDark = (request.headers.get('Cookie') || '').includes('theme=dark');

  const { generateSnippet } = await import('@sdk-it/typescript');
  async function snippet(
    path: string,
    method: string,
    operation: TunedOperationObject,
    partialSpec?: Partial<OpenAPIObject>,
  ) {
    const spec = augmentSpec({
      spec: {
        info: { title: 'SDK It Example', version: '1.0.0' },
        openapi: '3.0.0',
        paths: {
          [path]: {
            [method]: operation,
          },
        },
        ...partialSpec,
      },
    });
    const [entry] = forEachOperation(
      { spec: spec },
      (entry, operation) => [entry, operation] as const,
    );
    return processor.process(
      generateSnippet(spec, { output: '' }, entry[0], entry[1]),
    );
  }

  //   const client = new Serverize({
  //     baseUrl: 'http://localhost:3000',
  //   });
  //  const [r]= await client.request('GET /projects', {
  //     workspaceId: 'example-workspace',
  //   });
  const operations = {
    'basic/TypeSafety': {
      title: 'Type Safety',
      _spec: createOperation({
        name: 'typeSafety',
        group: 'basic',
        parameters: {
          query: {
            id: {
              required: true,
              schema: {
                type: 'string',
              },
            },
            count: {
              required: false,
              schema: {
                type: 'integer',
                default: 1,
              },
            },
          },
        },
        response: {
          '200-application/json': {
            type: 'object',
            properties: {
              id: { type: 'string' },
              count: { type: 'integer' },
              createdAt: { type: 'string', format: 'date-time' },
            },
          },
        },
      }),
      _typescript() {
        return processor.process(
          [
            '```typescript twoslash',
            `import { Serverize } from '@serverize/client';

const client = new Serverize({
  baseUrl: 'http://localhost:3000',
});

const [result] = await client.request('GET /projects', {
  workspaceId: '${crypto.randomUUID()}',
});

console.log(result);`,
            '```',
          ].join('\n'),
        );
      },
    },
    'basic/Polymorphism': {
      title: 'Polymorphism',
      _spec: createOperation({
        name: 'polymorphism',
        group: 'basic',
        parameters: {
          query: {
            type: {
              required: true,
              schema: {
                type: 'string',
                enum: ['A', 'B'],
              },
            },
          },
        },
        response: {
          '200-application/json': {
            oneOf: [
              {
                type: 'object',
                properties: {
                  type: { type: 'string', enum: ['A'] },
                  dataA: { type: 'string' },
                },
              },
              {
                type: 'object',
                properties: {
                  type: { type: 'string', enum: ['B'] },
                  dataB: { type: 'number' },
                },
              },
            ],
          },
        },
      }),
      _typescript() {
        return snippet('/basic/Polymorphism', 'get', this._spec);
      },
    },
    'pagination/page': {
      title: 'Page-based Pagination',
      _spec: createOperation({
        name: 'page',
        group: 'pagination',
        parameters: {
          query: {
            pageNo: {
              required: true,
              schema: {
                type: 'integer',
              },
            },
            pageSize: {
              required: true,
              schema: {
                type: 'integer',
              },
            },
          },
        },
        response: {
          '200-application/json': {
            type: 'object',
            properties: {
              items: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    name: { type: 'string' },
                    createdAt: { type: 'string', format: 'date-time' },
                  },
                },
              },
              total: {
                type: 'integer',
              },
              hasMore: {
                type: 'boolean',
              },
            },
          },
        },
      }),
      _typescript() {
        return snippet('/pagination/page', 'get', this._spec);
      },
    },
    'pagination/cursor': {
      title: 'Cursor-based Pagination',
      _spec: createOperation({
        name: 'cursorPagination',
        group: 'pagination',
        parameters: {
          query: {
            cursor: {
              required: false,
              schema: {
                type: 'string',
              },
            },
            limit: {
              required: false,
              schema: {
                type: 'integer',
              },
            },
          },
        },
        response: {
          '200-application/json': {
            type: 'object',
            properties: {
              items: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    name: { type: 'string' },
                    createdAt: { type: 'string', format: 'date-time' },
                  },
                },
              },
              nextCursor: {
                type: ['string', 'null'],
              },
              hasMore: {
                type: 'boolean',
              },
            },
          },
        },
      }),
      _typescript() {
        return snippet('/pagination/cursor', 'get', this._spec);
      },
    },
    'pagination/offset': {
      title: 'Offset-based Pagination',
      _spec: createOperation({
        name: 'offsetPagination',
        group: 'pagination',
        parameters: {
          query: {
            offset: {
              required: false,
              schema: {
                type: 'integer',
              },
            },
            limit: {
              required: false,
              schema: {
                type: 'integer',
              },
            },
          },
        },
        response: {
          '200-application/json': {
            type: 'object',
            properties: {
              items: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    name: { type: 'string' },
                    createdAt: { type: 'string', format: 'date-time' },
                  },
                },
              },
              total: {
                type: 'integer',
              },
              hasMore: {
                type: 'boolean',
              },
            },
          },
        },
      }),
      _typescript() {
        return snippet('/pagination/offset', 'get', this._spec);
      },
    },
    'FileUpload/streaming': {
      title: 'Streaming File Upload',
      _spec: createOperation({
        name: 'uploadFileStream',
        group: 'fileupload',
        parameters: {
          header: {
            'Content-Type': {
              required: true,
              schema: {
                type: 'string',
                enum: ['application/octet-stream'],
              },
            },
            'Content-Length': {
              required: false,
              schema: {
                type: 'integer',
              },
            },
          },
        },
        response: {
          '200-application/json': {
            type: 'object',
            properties: {
              fileId: {
                type: 'string',
              },
              size: {
                type: 'integer',
              },
              uploadedAt: {
                type: 'string',
                format: 'date-time',
              },
            },
          },
        },
      }),
      _typescript() {
        return snippet('/fileupload/streaming', 'post', this._spec);
      },
    },
    'FileUpload/multipart': {
      title: 'Multipart File Upload',
      _spec: createOperation({
        name: 'uploadFileMultipart',
        group: 'fileupload',
        parameters: {
          query: {
            overwrite: {
              required: false,
              schema: {
                type: 'boolean',
                default: false,
              },
            },
          },
        },
        response: {
          '200-application/json': {
            type: 'object',
            properties: {
              files: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    fileId: { type: 'string' },
                    filename: { type: 'string' },
                    size: { type: 'integer' },
                    uploadedAt: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
        },
        request: {
          'multipart/form-data': {
            type: 'object',
            required: ['files'],
            properties: {
              files: {
                type: 'array',
                items: {
                  type: 'string',
                  format: 'binary',
                },
              },
            },
          },
        },
      }),
      _typescript() {
        return snippet('/fileupload/multipart', 'post', this._spec);
      },
    },
    'streaming/http': {
      title: 'HTTP Streaming',
      _spec: createOperation({
        name: 'streamData',
        group: 'streaming',
        parameters: {
          query: {
            format: {
              required: false,
              schema: {
                type: 'string',
                enum: ['json', 'csv', 'xml'],
                default: 'json',
              },
            },
          },
        },
        response: {
          '200-headers': {
            'Transfer-Encoding': {
              type: 'string',
            },
          },
          '200-application/json': {
            type: 'object',
            properties: {
              data: {
                type: 'array',
                items: {
                  type: 'object',
                },
              },
            },
          },
        },
      }),
      _typescript() {
        return snippet('/streaming/http', 'get', this._spec);
      },
    },
    'streaming/sse': {
      title: 'Server-Sent Events',
      _spec: createOperation({
        name: 'subscribeEvents',
        group: 'streaming',
        parameters: {
          query: {
            channel: {
              required: true,
              schema: {
                type: 'string',
              },
            },
            lastEventId: {
              required: false,
              schema: {
                type: 'string',
              },
            },
          },
          header: {
            Accept: {
              required: false,
              schema: {
                type: 'string',
                default: 'text/event-stream',
              },
            },
          },
        },
        response: {
          '200-text/event-stream': {},
        },
      }),
      _typescript() {
        return snippet('/streaming/sse', 'get', this._spec);
      },
    },
    'streaming/filedownload': {
      title: 'Streaming File Download',
      _spec: createOperation({
        name: 'downloadFile',
        group: 'filedownload',
        parameters: {
          path: {
            fileId: {
              required: true,
              schema: {
                type: 'string',
              },
            },
          },
        },
        response: {
          '200-application/octet-stream': {
            type: 'string',
            format: 'binary',
          },
        },
      }),
      _typescript() {
        return snippet('/filedownload/streaming', 'get', this._spec);
      },
    },
    'authentication/bearer': {
      title: 'Bearer Token Authentication',
      _spec: createOperation({
        name: 'authenticatedRequest',
        group: 'authentication',
        response: {
          '200-application/json': {
            type: 'object',
            properties: {
              message: {
                type: 'string',
              },
              user: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  username: { type: 'string' },
                  email: { type: 'string', format: 'email' },
                },
              },
            },
          },
        },
      }),
      _typescript() {
        return snippet('/authentication/bearer', 'get', this._spec, {
          security: [
            {
              BearerAuth: [],
            },
          ],
          components: {
            schemas: {},
            securitySchemes: {
              BearerAuth: {
                type: 'http',
                scheme: 'bearer',
              },
            },
          },
        });
      },
    },
    'authentication/api-key': {
      title: 'API Key Authentication',
      _spec: createOperation({
        name: 'apiKeyRequest',
        group: 'authentication',
        parameters: {
          header: {
            'X-API-Key': {
              required: true,
              schema: {
                type: 'string',
              },
            },
          },
        },
        response: {
          '200-application/json': {
            type: 'object',
            properties: {
              message: {
                type: 'string',
              },
              apiKeyInfo: {
                type: 'object',
                properties: {
                  keyId: { type: 'string' },
                  permissions: { type: 'array', items: { type: 'string' } },
                  expiresAt: { type: 'string', format: 'date-time' },
                },
              },
            },
          },
        },
      }),
      _typescript() {
        return snippet('/authentication/api-key', 'get', this._spec, {
          security: [
            {
              ApiKey: [],
            },
          ],
          components: {
            schemas: {},
            securitySchemes: {
              ApiKey: {
                type: 'apiKey',
                in: 'header',
                name: 'apiKey',
              },
            },
          },
        });
      },
    },
  };

  // resolve all snippets
  for (const operation of Object.values(operations)) {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    operation.typescript = String(await operation._typescript());
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    operation.spec = String(
      await processor.process(
        ['```json', JSON.stringify(operation._spec, null, 2), '```'].join('\n'),
      ),
    );
  }

  return {
    isDark,
    operations,
  };
}
