import { merge } from 'lodash-es';
import assert from 'node:assert';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  OpenAPIObject,
  ReferenceObject,
  SchemaObject,
} from 'openapi3-ts/oas31';
import { camelcase } from 'stringcase';

import {
  followRef,
  getFolderExportsV2,
  isEmpty,
  isRef,
  notRef,
  pascalcase,
  snakecase,
  writeFiles,
} from '@sdk-it/core';
import { forEachOperation } from '@sdk-it/spec';

import { DartSerializer } from './dart-emitter.ts';
import interceptors from './interceptors.txt';

function tuneSpec(
  spec: OpenAPIObject,
  schemas: Record<string, SchemaObject | ReferenceObject>,
  refs: { name: string; value: SchemaObject }[],
) {
  for (const [name, schema] of Object.entries(schemas)) {
    if (isRef(schema)) continue;

    if (schema.allOf && Array.isArray(schema.allOf) && schema.allOf.length) {
      const schemas = schema.allOf;
      const refs = schemas.filter(isRef);
      const nonRefs = schemas.filter(notRef);
      if (nonRefs.some((it) => it.type && it.type !== 'object')) {
        assert(false, `allOf ${name} must be an object`);
      }
      const objectSchema = merge(
        {},
        ...nonRefs,
        ...refs.map((ref) => followRef(spec, ref.$ref)),
      );
      delete objectSchema.allOf;
      delete schema.allOf;
      Object.assign(schema, objectSchema);
    }

    if (schema.type === 'object') {
      if (!isEmpty(schema.oneOf)) {
        for (const oneOfIdx in schema.oneOf) {
          const oneOf = schema.oneOf[oneOfIdx];
          if (isRef(oneOf)) continue;
          if (!isEmpty(oneOf.required) && schema.properties) {
            schema.oneOf[oneOfIdx] = schema.properties[oneOf.required[0]];
          }
        }

        delete schema.type;
        tuneSpec(spec, schemas, refs);
        continue;
      }

      schema.properties ??= {};

      for (const [propName, value] of Object.entries(schema.properties)) {
        if (isRef(value)) continue;
        const refName = pascalcase(`${name} ${propName.replace('[]', '')}`);
        refs.push({ name: refName, value });
        schema.properties[propName] = {
          $ref: `#/components/schemas/${refName}`,
        };
        const props = Object.fromEntries(
          Object.entries(value.properties ?? {}).map(([key, value]) => {
            return [pascalcase(`${refName} ${key}`), value];
          }),
        );
        tuneSpec(spec, props, refs);
        // if (value.oneOf && Array.isArray(value.oneOf) && value.oneOf.length) {
        //   for (const oneOfIdx in value.oneOf) {
        //     const oneOf = value.oneOf[oneOfIdx];
        //     if (isRef(oneOf)) continue;
        //     if (oneOf.type === 'string') {
        //       console.log(refName);
        //       // const refName= pascalcase(`${name} ${key} ${oneOfIdx}`);
        //       // schema.oneOf[oneOfIdx] = {
        //       //   $ref: `#/components/schemas/${refName}`,
        //       // };
        //     }
        //   }
        // }
      }
    } else if (schema.type === 'array') {
      if (isRef(schema.items)) continue;
      const refName = name;
      refs.push({ name: refName, value: schema.items ?? {} });
      schema.items = {
        $ref: `#/components/schemas/${refName}`,
      };
    }
  }
}
export async function generate(
  spec: OpenAPIObject,
  settings: {
    output: string;
    name?: string;
    /**
     * full: generate a full project including package.json and tsconfig.json. useful for monorepo/workspaces
     * minimal: generate only the client sdk
     */
    mode?: 'full' | 'minimal';
    formatCode?: (options: { output: string }) => void | Promise<void>;
  },
) {
  const output =
    settings.mode === 'full' ? join(settings.output, 'src') : settings.output;
  const groups: Record<
    string,
    {
      use: string;
      methods: string[];
    }
  > = {};
  spec.components ??= {};
  spec.components.schemas ??= {};

  forEachOperation({ spec }, (entry, operation) => {
    console.log(`Processing ${entry.method} ${entry.path}`);
    const group =
      groups[entry.groupName] ??
      (groups[entry.groupName] = {
        methods: [],
        use: `final ${entry.groupName} = new ${pascalcase(entry.groupName)}();`,
      });
    group.methods.push(`
        Future<http.Response> ${camelcase(operation.operationId)}() async {
          final stream = await this.dispatcher.dispatch(RequestConfig(
            method: '${entry.method}',
            url: Uri.parse('${entry.path}'),
            headers: {},
          ));
          final response = await http.Response.fromStream(stream);
          return response;
      }
    `);
  });

  const newRefs: { name: string; value: SchemaObject }[] = [];
  tuneSpec(spec, spec.components.schemas, newRefs);
  for (const ref of newRefs) {
    spec.components.schemas[ref.name] = ref.value;
  }
  await writeFile(
    join(process.cwd(), 'openai.json'),
    JSON.stringify(spec, null, 2),
  );

  const models = Object.entries(spec.components.schemas).reduce<
    Record<string, string>
  >((acc, [name, schema]) => {
    const serializer = new DartSerializer(spec, (name, content) => {
      acc[`models/${snakecase(name)}.dart`] =
        `import 'dart:typed_data'; import './index.dart';\n\n${content}`;
    });
    serializer.handle(pascalcase(name), schema);
    return acc;
  }, {});

  const clazzez = Object.entries(groups).reduce<Record<string, string>>(
    (acc, [name, { methods }]) => {
      return {
        ...acc,
        [`api/${snakecase(name)}.dart`]: `
import 'package:http/http.dart' as http;
import '../interceptors.dart';
import '../http.dart';

    class ${pascalcase(name)} {
      final Dispatcher dispatcher;
      ${pascalcase(name)}(this.dispatcher);
      ${methods.join('\n')}
    }
    `,
      };
    },
    {},
  );

  const client = `
  ${Object.keys(groups)
    .map((name) => `import './api/${snakecase(name)}.dart';`)
    .join('\n')}
import './interceptors.dart';
import './http.dart';

  class Client {
  final Options options;
${Object.keys(groups)
  .map((name) => `late final ${pascalcase(name)} ${camelcase(name)};`)
  .join('\n')}

  Client(this.options) {
    final interceptors = [new BaseUrlInterceptor(() => this.options.baseUrl)];
    final dispatcher = new Dispatcher(interceptors);
    ${Object.keys(groups)
      .map(
        (name) =>
          `this.${camelcase(name)} = new ${pascalcase(name)}(dispatcher);`,
      )
      .join('\n')}

      }

    void setOptions({String? baseUrl}) {
      if (baseUrl != null) {
        options.baseUrl = baseUrl;
      }
    }
  }


class Options {
  String baseUrl;
  Options({required this.baseUrl});
}

  `;
  await writeFiles(output, {
    ...models,
  });

  await writeFiles(output, {
    'models/index.dart': await getFolderExportsV2(join(output, 'models'), {
      exportSyntax: 'export',
      extensions: ['dart'],
    }),
    'index.dart': client,
    'interceptors.dart': interceptors,
    'http.dart': `
import 'interceptors.dart';
import 'package:http/http.dart' as http;

class Dispatcher {
  final List<Interceptor> interceptors;

  Dispatcher(this.interceptors);

  Future<http.StreamedResponse> dispatch(RequestConfig config) {
    final modifedConfig = interceptors.fold(
      config,
      (acc, interceptor) => interceptor.before(acc),
    );
    final request = http.Request(modifedConfig.method, modifedConfig.url);
    return request.send();
  }
}
`,
    ...clazzez,
    // 'index.dart': await getFolderExports(output, settings.useTsExtension),
  });

  await settings.formatCode?.({
    output: output,
  });
}
