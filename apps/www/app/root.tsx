import {
  Links,
  type LinksFunction,
  Meta,
  type MetaFunction,
  Outlet,
  Scripts,
  ScrollRestoration,
} from 'react-router';

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
  const isDark = (request.headers.get('Cookie') || '').includes('theme=true');

  const { generateSnippet } = await import('@sdk-it/typescript');
  function snippet(
    path: string,
    method: string,
    operation: TunedOperationObject,
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
      },
    });
    const [entry] = forEachOperation(
      { spec: spec },
      (entry, operation) => [entry, operation] as const,
    );
    return generateSnippet(spec, { output: '' }, entry[0], entry[1], {
      frame: true,
    });
  }

  const operations = {
    'pagination/page': {
      title: 'Page-based Pagination',
      spec: createOperation({
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
      }),
      get typescript() {
        return snippet('/pagination/page', 'get', this.spec);
      },
    },
    'pagination/cursor': {
      title: 'Cursor-based Pagination',
      spec: createOperation({
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
      }),
      get typescript() {
        return snippet('/pagination/cursor', 'get', this.spec);
      },
    },
    'pagination/offset': {
      title: 'Offset-based Pagination',
      spec: createOperation({
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
      }),
      get typescript() {
        return snippet('/pagination/offset', 'get', this.spec);
      },
    },
    'filedownload/streaming': {
      title: 'Streaming File Download',
      spec: createOperation({
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
          header: {
            'Accept-Encoding': {
              required: false,
              schema: {
                type: 'string',
                enum: ['gzip', 'deflate', 'br'],
              },
            },
          },
        },
        response: {
          '200-application/octet-stream': {},
        },
      }),
      get typescript() {
        return snippet('/filedownload/streaming', 'get', this.spec);
      },
    },
    'filedownload/buffer': {
      title: 'Buffer File Download',
      spec: createOperation({
        name: 'downloadFileBuffer',
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
          '200-application/octet-stream': {},
        },
      }),
      get typescript() {
        return snippet('/filedownload/buffer', 'get', this.spec);
      },
    },
    'fileupload/streaming': {
      title: 'Streaming File Upload',
      spec: createOperation({
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
      }),
      get typescript() {
        return snippet('/fileupload/streaming', 'post', this.spec);
      },
    },
    'fileupload/multipart': {
      title: 'Multipart File Upload',
      spec: createOperation({
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
      }),
      get typescript() {
        return snippet('/fileupload/multipart', 'post', this.spec);
      },
    },
    'streaming/http': {
      title: 'HTTP Streaming',
      spec: createOperation({
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
          header: {
            Accept: {
              required: false,
              schema: {
                type: 'string',
                default: 'application/json',
              },
            },
          },
        },
        response: {
          '200-application/json': {
            data: {
              type: 'array',
              items: {
                type: 'object',
              },
            },
          },
        },
      }),
      get typescript() {
        return snippet('/streaming/http', 'get', this.spec);
      },
    },
    'streaming/sse': {
      title: 'Server-Sent Events',
      spec: createOperation({
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
      get typescript() {
        return snippet('/streaming/sse', 'get', this.spec);
      },
    },
    'authentication/bearer': {
      title: 'Bearer Token Authentication',
      spec: createOperation({
        name: 'authenticatedRequest',
        group: 'authentication',
        parameters: {
          header: {
            Authorization: {
              required: true,
              schema: {
                type: 'string',
                pattern: '^Bearer .+',
              },
            },
          },
        },
        response: {
          '200-application/json': {
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
      }),
      get typescript() {
        return snippet('/authentication/bearer', 'get', this.spec);
      },
    },
    'authentication/api-key': {
      title: 'API Key Authentication',
      spec: createOperation({
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
      }),
      get typescript() {
        return snippet('/authentication/api-key', 'get', this.spec);
      },
    },
  };

  return {
    isDark,
    operations,
  };
}
