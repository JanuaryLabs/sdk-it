import HTTPSnippet from 'httpsnippet';
import type {
  OpenAPIObject,
  ParameterObject,
  RequestBodyObject,
} from 'openapi3-ts/oas31';
import type { ShouldRevalidateFunctionArgs } from 'react-router';
import {
  Links,
  type LinksFunction,
  Meta,
  type MetaFunction,
  Outlet,
  Scripts,
  ScrollRestoration,
} from 'react-router';

import { followRef, isRef } from '@sdk-it/core';
import { loadRemote } from '@sdk-it/spec/loaders/remote-loader.js';
import {
  type TunedOperationObject,
  augmentSpec,
  forEachOperation,
} from '@sdk-it/spec/operation.js';
import { toSidebar } from '@sdk-it/spec/sidebar.js';
import { TypeScriptGenerator } from '@sdk-it/typescript';

import type { AugmentedOperation } from './api-doc/types';
import './styles.css';

export const meta: MetaFunction = (args) => {
  return [
    {
      title: 'API Reference',
    },
  ];
};

export const links: LinksFunction = () => [
  { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
  {
    rel: 'preconnect',
    href: 'https://fonts.gstatic.com',
    crossOrigin: 'anonymous',
  },
  // {
  //   rel: 'stylesheet',
  //   href: `https://fonts.googleapis.com/css2?family=Figtree:ital,wght@0,300..700;1,300..900&display=swap`,
  // },
  // {
  //   rel: 'stylesheet',
  //   href: `https://fonts.googleapis.com/css2?family=Geist:wght@300..700&display=swap`,
  // },
  {
    rel: 'stylesheet',
    href: `https://fonts.googleapis.com/css2?family=Geist:wght@100..900&family=Open+Sans:ital,wght@0,300..800;1,300..800&display=swap`,
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
  return (
    <html lang="en" className="light">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body className="invisible">
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

export async function loader({
  request,
  params,
}: {
  request: Request;
  params: { '*'?: string };
}) {
  // 'https://raw.githubusercontent.com/openai/openai-openapi/refs/heads/master/openapi.yaml',
  // 'https://api.openstatus.dev/v1/openapi',

  const urlObj = new URL(request.url);
  const specUrl =
    urlObj.searchParams.get('spec') ??
    import.meta.env.VITE_SPEC ??
    (import.meta.env.DEV
      ? 'https://raw.githubusercontent.com/openai/openai-openapi/refs/heads/master/openapi.yaml'
      : // ?'https://raw.githubusercontent.com/readmeio/oas-examples/main/3.1/json/petstore.json'
        '');
  const spec = augmentSpec({ spec: await loadRemote<OpenAPIObject>(specUrl) });

  const operationsMap: Record<
    string,
    { entry: AugmentedOperation; operation: TunedOperationObject }
  > = {};
  const generator = new TypeScriptGenerator(spec, {
    output: '',
  });

  const getExampleOrPlaceholder = (param: ParameterObject): string => {
    if (param.example) return String(param.example);
    if (param.schema && 'example' in param.schema && param.schema.example) {
      return String(param.schema.example);
    }
    const type =
      (param.schema && 'type' in param.schema && param.schema.type) || 'string';
    return `<${type}>`;
  };

  forEachOperation({ spec }, (entry, operation) => {
    const operationId = operation.operationId;

    const generateExampleFromBody = (body: RequestBodyObject): string => {
      if (!body?.content?.['application/json']?.schema) {
        return '{}';
      }

      const schema = isRef(body.content['application/json'].schema)
        ? followRef(spec, body.content['application/json'].schema.$ref)
        : body.content['application/json'].schema;
      const example: Record<string, unknown> = {};
      schema.properties ??= {};
      for (const key in schema.properties) {
        const property = isRef(schema.properties[key])
          ? followRef(spec, schema.properties[key].$ref)
          : schema.properties[key];
        example[key] = property.type || key;
      }
      return JSON.stringify(example, null, 2);
    };

    let urlPath = entry.path;
    operation.parameters
      .filter((it) => it.in === 'path')
      .forEach((param) => {
        const value = getExampleOrPlaceholder(param);
        urlPath = urlPath.replace(`{${param.name}}`, value);
      });

    const url = spec.servers?.[0]?.url;
    const snippet = new HTTPSnippet({
      url: (!url || url === '/' ? 'https://' : url) + urlPath,
      method: entry.method.toUpperCase(),
      comment: operation.description,
      bodySize: -1,
      cookies: [],
      headers: [
        {
          name: 'Content-Type',
          value: 'application/json',
        },
        ...operation.parameters
          .filter((it) => it.in === 'header')
          .map((it) => ({
            name: it.name,
            value: getExampleOrPlaceholder(it), // Use helper function
          })),
      ],
      headersSize: -1,
      httpVersion: 'HTTP/1.1',
      queryString: operation.parameters
        .filter((it) => it.in === 'query')
        .map((it) => ({
          name: it.name,
          value: getExampleOrPlaceholder(it), // Use helper function
        })),
      ...(operation.requestBody && {
        postData: {
          mimeType: 'application/json',
          text: generateExampleFromBody(operation.requestBody),
        },
      }),
    });

    const curlOutput = snippet.convert('shell', 'curl', {
      indent: '\t',
      short: true,
    });
    if (curlOutput === false) {
      throw new Error(`Failed to convert to curl for ${operationId}`);
    }

    // const curlOutput = '';
    operationsMap[operationId] = {
      entry: {
        ...entry,
        snippets: [
          {
            language: 'TypeScript',
            code: generator.snippet(entry, operation),
          },
          {
            language: 'CURL',
            code: ['```shell frame="none"', curlOutput, '```'].join('\n'),
          },
        ],
      },
      operation,
    };
  });

  return {
    spec,
    sidebar: toSidebar(spec),
    operationsMap,
  };
}
// export function ErrorBoundary(a: any) {
//   return redirect('/');
// }

export function shouldRevalidate(arg: ShouldRevalidateFunctionArgs) {
  return false;
}
