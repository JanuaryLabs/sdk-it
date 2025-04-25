import HTTPSnippet from 'httpsnippet';
import type { ParameterObject, RequestBodyObject } from 'openapi3-ts/oas31';
import { join } from 'path';

import { followRef, isRef } from '@sdk-it/core';
import { loadSpec } from '@sdk-it/spec';
import {
  type TunedOperationObject,
  forEachOperation,
} from '@sdk-it/spec/operation.js';
import { toSidebar } from '@sdk-it/spec/sidebar.js';
import { TypeScriptGenerator } from '@sdk-it/typescript';

import { ApiContent } from './api-doc/api-content';
import { ApiHeader } from './api-doc/api-header';
import type { AugmentedOperation } from './api-doc/types';
import { useScrollOperations } from './hooks/use-scroll-operations';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
  SidebarRail,
} from './shadcn/sidebar';
import { NavMain } from './sidebar/nav';
import { SpecProvider } from './spec-context';

type PromisedValue<T> = T extends Promise<infer U> ? U : never;

export async function loader({ params }: { params: { '*'?: string } }) {
  // console.log(join(process.cwd(),'../','../','.yamls','openai.yaml'));
  // const spec = await loadRemote<OpenAPIObject>(
  //   'https://raw.githubusercontent.com/openai/openai-openapi/refs/heads/master/openapi.yaml',
  //   // 'https://api.openstatus.dev/v1/openapi',
  // );
  const spec = await loadSpec(
    join(process.cwd(), '../', '../', '.yamls', 'openai.yaml'),
  );

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

    const snippet = new HTTPSnippet({
      url: (spec.servers?.[0]?.url || '') + urlPath,
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
    sidebar: toSidebar(spec, params['*'] || ''),
    operationsMap,
  };
}

export default function Page({
  loaderData: { sidebar: sidebarData, spec, operationsMap },
}: {
  loaderData: PromisedValue<ReturnType<typeof loader>>;
}) {
  const { contentRef } = useScrollOperations({
    sidebarData,
  });

  return (
    <SpecProvider spec={spec}>
      <SidebarProvider>
        <Sidebar collapsible="icon">
          <SidebarHeader>
            {/* <TeamSwitcher teams={data.teams} /> */}
          </SidebarHeader>
          <SidebarContent className="gap-x-2 gap-y-0">
            <NavMain items={sidebarData} />
            {/* <NavProjects projects={data.projects} /> */}
          </SidebarContent>
          <SidebarFooter>{/* <NavUser user={data.user} /> */}</SidebarFooter>
          <SidebarRail />
        </Sidebar>
        <SidebarInset>
          <ApiHeader title={spec.info.title} />
          <ApiContent
            contentRef={contentRef}
            info={spec.info}
            sidebarData={sidebarData}
            operationsMap={operationsMap}
          />
        </SidebarInset>
      </SidebarProvider>
    </SpecProvider>
  );
}
