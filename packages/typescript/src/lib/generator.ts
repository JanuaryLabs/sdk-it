import { join } from 'node:path';

import {
  type IR,
  forEachOperation,
  inputEndpoint,
  operationInputs,
} from '@sdk-it/spec';

import { ZodEmitter } from './emitters/zod.ts';
import { groupIdentifier } from './group-identifier.ts';
import { inputSchemaName } from './input-schema-name.ts';
import type { ModelNamer } from './model-name.ts';
import { moduleFileName } from './module-file.ts';
import { type Operation, type Spec, toEndpoint } from './sdk.ts';
import type { Style } from './style.ts';
import endpointsTxt from './styles/github/endpoints.txt';

export interface NamedImport {
  name: string;
  alias?: string;
  isTypeOnly: boolean;
}
export interface Import {
  isTypeOnly: boolean;
  moduleSpecifier: string;
  defaultImport: string | undefined;
  namedImports: NamedImport[];
  namespaceImport: string | undefined;
}

export function generateCode(config: {
  /**
   * No support for jsdoc in vscode
   * @issue https://github.com/microsoft/TypeScript/issues/38106
   */
  spec: IR;
  style: Style;
  makeImport: (module: string) => string;
  modelName: ModelNamer;
}) {
  const commonZod = new Map<string, string>();
  const commonZodImports: Import[] = [];
  const zodDeserialzer = new ZodEmitter(
    config.spec,
    config.modelName,
    (model, schema) => {
      commonZod.set(model, schema);
      commonZodImports.push({
        defaultImport: undefined,
        isTypeOnly: true,
        moduleSpecifier: `./${config.makeImport(model)}`,
        namedImports: [{ isTypeOnly: true, name: model }],
        namespaceImport: undefined,
      });
    },
  );

  const groups: Spec['operations'] = {};
  const endpoints: Record<string, ReturnType<typeof toEndpoint>[]> = {};

  forEachOperation(config.spec, (entry, operation) => {
    groups[entry.tag] ??= [];
    endpoints[entry.tag] ??= [];
    const endpoint = `${entry.method.toUpperCase()} ${entry.path}`;
    const route: Operation = {
      method: entry.method,
      path: entry.path,
      operationId: operation.operationId,
      inputs: operationInputs(config.spec, operation).map((input) => ({
        endpoint: inputEndpoint(endpoint, input),
        schemaName: inputSchemaName(operation.operationId, input),
        zod: zodDeserialzer.handle(input.schema, true),
        input,
      })),
    };
    endpoints[entry.tag].push(
      toEndpoint(entry.tag, operation, route, config.modelName),
    );
    groups[entry.tag].push(route);
  });
  const allSchemas = Object.keys(endpoints).map((it) => ({
    import: `import ${groupIdentifier(it)} from './${config.makeImport(moduleFileName(it))}';`,
    use: `  ...${groupIdentifier(it)}`,
  }));

  return {
    groups,
    commonZod,
    endpoints: {
      [join('api', 'endpoints.ts')]: `
import type { z } from 'zod';
import type { ParseError } from '${config.makeImport('../http/parser')}';
import type { ProblematicResponse, SuccessfulResponse, APIResponse } from '${config.makeImport(
        '../http/response',
      )}';

import schemas from '${config.makeImport('./schemas')}';
import type { Unionize } from '${config.makeImport('../http/dispatcher')}';
      ${endpointsTxt}`,
      [`${join('api', 'schemas.ts')}`]:
        `${allSchemas.map((it) => it.import).join('\n')}

export default {\n${allSchemas.map((it) => it.use).join(',\n')}\n};

`.trim(),
      ...Object.fromEntries(
        Object.entries(endpoints)
          .map(([name, endpoint]) => {
            const operations = endpoint.flatMap((it) => it.schemas).join(',\n');
            return [
              [
                join('api', `${moduleFileName(name)}.ts`),
                `${[
                  `import { z } from 'zod';`,
                  `import * as http from '${config.makeImport('../http/response')}';`,
                  ...(operations.includes('outputs.')
                    ? [
                        `import * as outputs from '${config.makeImport('../outputs/index')}';`,
                      ]
                    : []),
                  `import { toRequest, json, urlencoded, formdata, text, binary, empty, type HeadersInit } from '${config.makeImport('../http/request')}';`,
                  `import { chunked, buffered, bodyless } from "${config.makeImport('../http/parse-response')}";`,
                  `import { sse, type SSEListener } from "${config.makeImport('../http/sse')}";`,
                  `import * as ${groupIdentifier(name)} from '../inputs/${config.makeImport(moduleFileName(name))}';`,
                  `import { createHeadersInterceptor, type Interceptor } from '${config.makeImport('../http/interceptors')}';`,
                  `import { Dispatcher, fetchType, type InstanceType } from '${config.makeImport('../http/dispatcher')}';`,
                  `import { Pagination, OffsetPagination, CursorPagination } from "${config.makeImport('../pagination/index')}";`,
                ].join('\n')}\nexport default {\n${operations}\n}`,
              ],
            ];
          })
          .flat(),
      ),
    },
  };
}
