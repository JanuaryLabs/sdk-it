import { parse as partContentType } from 'fast-content-type-parse';
import { merge } from 'lodash-es';
import assert from 'node:assert';
import { readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  OpenAPIObject,
  OperationObject,
  ReferenceObject,
  ResponseObject,
  SchemaObject,
} from 'openapi3-ts/oas31';
import { camelcase } from 'stringcase';
import yaml from 'yaml';

import {
  followRef,
  isEmpty,
  isRef,
  notRef,
  pascalcase,
  snakecase,
} from '@sdk-it/core';
import {
  type ReadFolderFn,
  type Writer,
  getFolderExportsV2,
  writeFiles,
} from '@sdk-it/core/file-system.js';
import {
  type Operation,
  forEachOperation,
  isStreamingContentType,
  isSuccessStatusCode,
  parseJsonContentType,
  patchParameters,
} from '@sdk-it/spec';

import { DartSerializer, isObjectSchema } from './dart-emitter.ts';
import dispatcherTxt from './http/dispatcher.txt';
import interceptorsTxt from './http/interceptors.txt';
import responsesTxt from './http/responses.txt';

function tuneSpec(
  spec: OpenAPIObject,
  schemas: Record<string, SchemaObject | ReferenceObject>,
  refs: { name: string; value: SchemaObject }[],
) {
  for (const [name, schema] of Object.entries(schemas)) {
    if (isRef(schema)) continue;

    if (!isEmpty(schema.anyOf) && !isEmpty(schema.oneOf)) {
      delete schema.anyOf;
    }
    if (!isEmpty(schema.allOf)) {
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
    writer?: Writer;
    readFolder?: ReadFolderFn;
    /**
     * full: generate a full project including package.json and tsconfig.json. useful for monorepo/workspaces
     * minimal: generate only the client sdk
     */
    mode?: 'full' | 'minimal';
    formatCode?: (options: { output: string }) => void | Promise<void>;
  },
) {
  settings.writer ??= writeFiles;
  settings.readFolder ??= async (folder: string) => {
    const files = await readdir(folder, { withFileTypes: true });
    return files.map((file) => ({
      fileName: file.name,
      filePath: join(file.parentPath, file.name),
      isFolder: file.isDirectory(),
    }));
  };
  const clientName = settings.name || 'Client';
  const output = join(settings.output, 'lib');
  const groups: Record<
    string,
    {
      use: string;
      methods: string[];
    }
  > = {};
  spec.components ??= {};
  spec.components.schemas ??= {};
  const inputs: Record<string, string> = {};
  const outputs: Record<string, string> = {};
  forEachOperation({ spec }, (entry, operation) => {
    // if (entry.path !== '/v6/prepareUpload') {
    //   return;
    // }
    operation.responses ??= {};
    spec.components ??= {};
    spec.components.schemas ??= {};
    for (const status in operation.responses) {
      if (!isSuccessStatusCode(status)) continue;
      const response = operation.responses[status];
      if (!isEmpty(response.content)) {
        for (const [contentType, mediaType] of Object.entries(
          response.content,
        )) {
          if (parseJsonContentType(contentType)) {
            if (mediaType.schema && !isRef(mediaType.schema)) {
              const outputName = pascalcase(`${operation.operationId} output`);
              spec.components.schemas[outputName] = mediaType.schema;
              operation.responses[status].content ??= {};
              operation.responses[status].content[contentType].schema = {
                $ref: `#/components/schemas/${outputName}`,
              };
            }
          }
          // handle chunked response
        }
      }
    }
    console.log(`Processing ${entry.method} ${entry.path}`);
    const group =
      groups[entry.groupName] ??
      (groups[entry.groupName] = {
        methods: [],
        use: `final ${entry.groupName} = new ${pascalcase(entry.groupName)}();`,
      });

    const input = toInputs(spec, { entry, operation });
    Object.assign(inputs, input.inputs);

    const response = toOutput(spec, operation);
    if (response) {
      Object.assign(outputs, response.outputs);
    }
    group.methods.push(`
        Future<${response ? response.returnType : 'http.StreamedResponse'}> ${camelcase(operation.operationId)}(
       ${isEmpty(operation.requestBody) ? '' : `${input.inputName} input`}
        ) async {
          final stream = await this.dispatcher.${input.contentType}(RequestConfig(
            method: '${entry.method}',
            url: Uri.parse('${entry.path}'),
            headers: {},
          ), ${['json', 'multipart'].includes(input.contentType) ? input.encode : ``});
          ${response ? `${response.decode};` : 'return stream;'}
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
        `import 'dart:io';import 'dart:typed_data'; import './index.dart';\n\n${content}`;
    });
    serializer.handle(pascalcase(name), schema);
    return acc;
  }, {});

  const clazzez = Object.entries(groups).reduce<Record<string, string>>(
    (acc, [name, { methods }]) => {
      return {
        ...acc,
        [`api/${snakecase(name)}.dart`]: `
import 'dart:convert';

import 'package:http/http.dart' as http;

import '../interceptors.dart';
import '../inputs/index.dart';
import '../outputs/index.dart';
import '../models/index.dart';
import '../http.dart';

    class ${pascalcase(name)}Client {
      final Dispatcher dispatcher;
      final Receiver receiver;
      ${pascalcase(name)}Client(this.dispatcher, this.receiver);
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

  class ${clientName} {
  final Options options;
${Object.keys(groups)
  .map((name) => `late final ${pascalcase(name)}Client ${camelcase(name)};`)
  .join('\n')}

  ${clientName}(this.options) {
    final interceptors = [BaseUrlInterceptor(() => this.options.baseUrl), LoggingInterceptor()];
    final dispatcher = Dispatcher(interceptors);
    final receiver = Receiver(interceptors);
    ${Object.keys(groups)
      .map(
        (name) =>
          `this.${camelcase(name)} = ${pascalcase(name)}Client(dispatcher, receiver);`,
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
  await settings.writer(output, {
    ...models,
    ...inputs,
    ...outputs,
  });

  await settings.writer(output, {
    'models/index.dart': await getFolderExportsV2(
      join(output, 'models'),
      settings.readFolder,
      {
        exportSyntax: 'export',
        extensions: 'dart',
      },
    ),
    'inputs/index.dart': await getFolderExportsV2(
      join(output, 'inputs'),
      settings.readFolder,
      {
        exportSyntax: 'export',
        extensions: 'dart',
      },
    ),
    'outputs/index.dart': await getFolderExportsV2(
      join(output, 'outputs'),
      settings.readFolder,
      {
        exportSyntax: 'export',
        extensions: 'dart',
      },
    ),
    'interceptors.dart': interceptorsTxt,
    'http.dart': dispatcherTxt,
    'responses.dart': responsesTxt,
    ...clazzez,
  });
  await settings.writer(output, {
    'package.dart': `${await getFolderExportsV2(
      join(output),
      settings.readFolder,
      {
        exportSyntax: 'export',
        extensions: 'dart',
        ignore(dirent) {
          return !dirent.isFolder && dirent.fileName === 'package.dart';
        },
      },
    )}${client}`,
  });

  await settings.writer(settings.output, {
    'pubspec.yaml': {
      ignoreIfExists: true,
      content: yaml.stringify({
        name: settings.name
          ? `${snakecase(clientName.toLowerCase())}_sdk`
          : 'sdk',
        version: '0.0.1',
        environment: {
          sdk: '^3.7.2',
        },
        dependencies: {
          http: '^1.3.0',
          mime: '^2.0.0',
        },
      }),
    },
  });

  await settings.formatCode?.({
    output: output,
  });
}

function toInputs(spec: OpenAPIObject, { entry, operation }: Operation) {
  const inputs: Record<string, unknown> = {};
  const inputName = pascalcase(`${operation.operationId} input`);
  let contentType = 'empty';
  let encode = '';

  if (!isEmpty(operation.requestBody)) {
    for (const type in operation.requestBody.content) {
      const ctSchema = isRef(operation.requestBody.content[type].schema)
        ? followRef(spec, operation.requestBody.content[type].schema.$ref)
        : operation.requestBody.content[type].schema;

      if (!ctSchema) {
        console.warn(
          `Schema not found for ${type} in ${entry.method} ${entry.path}`,
        );
        continue;
      }

      ctSchema.properties ??= {};
      ctSchema.required ??= [];

      patchParameters(spec, ctSchema, operation);
      // if (ctSchema.type !== 'object') {
      //   ctSchema = {
      //     type: 'object',
      //     required: [operation.requestBody.required ? '$body' : ''],
      //     properties: {
      //       $body: ctSchema,
      //     },
      //   };
      // }

      const serializer = new DartSerializer(spec, (name, content) => {
        inputs[join(`inputs/${name}.dart`)] =
          `import 'dart:io';import 'dart:typed_data';import '../models/index.dart'; import './index.dart';\n\n${content}`;
      });
      const serialized = serializer.handle(inputName, ctSchema, true, {
        alias: isObjectSchema(ctSchema) ? undefined : inputName,
      });
      encode = serialized.encode as string;
      const [mediaType, mediaSubType] = partContentType(type).type.split('/');
      if (mediaType === 'application') {
        contentType = parseJsonContentType(type) as string;
      } else {
        contentType = mediaType;
      }

      // const schema = merge({}, objectSchema, {
      //   required: additionalProperties
      //     .filter((p) => p.required)
      //     .map((p) => p.name),
      //   properties: additionalProperties.reduce<Record<string, unknown>>(
      //     (acc, p) => ({
      //       ...acc,
      //       [p.name]: p.schema,
      //     }),
      //     {},
      //   ),
      // });

      // Object.assign(inputs, bodyInputs(config, objectSchema));
      // schemas[shortContenTypeMap[type]] = zodDeserialzer.handle(schema, true);
    }
  } else {
    const ctSchema: SchemaObject = {
      type: 'object',
    };
    patchParameters(spec, ctSchema, operation);

    const serializer = new DartSerializer(spec, (name, content) => {
      inputs[join(`inputs/${name}.dart`)] =
        `import 'dart:io';import 'dart:typed_data';import '../models/index.dart'; import './index.dart';\n\n${content}`;
    });
    const serialized = serializer.handle(inputName, ctSchema, true, {
      alias: isObjectSchema(ctSchema) ? undefined : inputName,
    });
    encode = serialized.encode as string;
  }

  return { inputs, inputName, contentType, encode };
}

function toOutput(spec: OpenAPIObject, operation: OperationObject) {
  const outputName = pascalcase(`${operation.operationId} output`);
  operation.responses ??= {};
  const outputs: Record<string, string> = {};
  for (const status in operation.responses) {
    const response = isRef(operation.responses[status] as ReferenceObject)
      ? followRef<ResponseObject>(spec, operation.responses[status].$ref)
      : (operation.responses[status] as ResponseObject);
    for (const type in response.content) {
      const { schema } = response.content[type];
      if (!schema) {
        console.warn(
          `Schema not found for ${type} in ${operation.operationId}`,
        );
        continue;
      }
      const serializer = new DartSerializer(spec, (name, content) => {
        // outputs[join(`outputs/${name}.dart`)] =
        //   `import 'dart:typed_data'; import '../models/index.dart'; \n\n${content}`;
      });
      if (isStreamingContentType(type)) {
        return {
          type: 'stream',
          outputName,
          outputs,
          decode: `return stream`,
          returnType: `http.StreamedResponse`,
        };
      }
      if (parseJsonContentType(type)) {
        const serialized = serializer.handle(outputName, schema, true, {
          // alias: outputName,
          noEmit: true,
        });
        return {
          type: 'json',
          outputName,
          outputs,
          decode: `final json = await this.receiver.json(stream); return ${serialized.fromJson}`,
          returnType: serialized.use,
        };
      }
    }
  }
  return null;
}
