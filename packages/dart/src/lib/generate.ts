import { parse as partContentType } from 'fast-content-type-parse';
import { readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  OpenAPIObject,
  OperationObject,
  ReferenceObject,
  ResponseObject,
} from 'openapi3-ts/oas31';
import { camelcase } from 'stringcase';
import yaml from 'yaml';

import { followRef, isEmpty, isRef, pascalcase, snakecase } from '@sdk-it/core';
import {
  type ReadFolderFn,
  type Writer,
  createWriterProxy,
  getFolderExportsV2,
  writeFiles,
} from '@sdk-it/core/file-system.js';
import {
  type Operation,
  augmentSpec,
  cleanFiles,
  forEachOperation,
  isStreamingContentType,
  isSuccessStatusCode,
  parseJsonContentType,
  readWriteMetadata,
} from '@sdk-it/spec';

import { DartSerializer, isObjectSchema } from './dart-emitter.ts';
import dispatcherTxt from './http/dispatcher.txt';
import interceptorsTxt from './http/interceptors.txt';
import responsesTxt from './http/responses.txt';

export async function generate(
  spec: OpenAPIObject,
  settings: {
    output: string;
    cleanup?: boolean;
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
  spec = augmentSpec({ spec }, true);
  const clientName = settings.name || 'Client';
  const output = join(settings.output, 'lib');
  const { writer, files: writtenFiles } = createWriterProxy(
    settings.writer ?? writeFiles,
    settings.output,
  );
  settings.writer = writer;
  settings.readFolder ??= async (folder: string) => {
    const files = await readdir(folder, { withFileTypes: true });
    return files.map((file) => ({
      fileName: file.name,
      filePath: join(file.parentPath, file.name),
      isFolder: file.isDirectory(),
    }));
  };
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
    // if (entry.path !== '/assistants' || entry.method !== 'post') {
    //   return;
    // }

    console.log(`Processing ${entry.method} ${entry.path}`);
    const group = (groups[entry.groupName] ??= {
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
       ${input.haveInput ? `${input.inputName} input` : ''}
        ) async {
          final stream = await this.dispatcher.${input.contentType}(RequestConfig(
            method: '${entry.method}',
            url: Uri.parse('${entry.path}'),
            headers: {},
           ${input.haveInput ? 'input: input.toRequest()' : ''}));
            ${response ? `${response.decode};` : 'return stream;'}
            }
            `);
  });

  await writeFile(
    join(settings.output, 'openapi.json'),
    JSON.stringify(spec, null, 2),
  );

  const models = Object.entries(spec.components.schemas).reduce<
    Record<string, string>
  >((acc, [name, schema]) => {
    const serializer = new DartSerializer(spec, (name, content, schema) => {
      const folder = schema['x-requestbody']
        ? 'inputs'
        : schema['x-responsebody']
          ? 'outputs'
          : 'models';
      acc[join(folder, `${snakecase(name)}.dart`)] = [
        `import 'dart:io';`,
        `import 'dart:typed_data';`,
        `import './index.dart';`,
        `import '../interceptors.dart';`,
        folder === 'inputs' || folder === 'outputs'
          ? `import '../models/index.dart';`
          : '',
        content,
      ].join('\n');
    });
    serializer.handle(pascalcase(name), schema, true, {
      requestize: isRef(schema) ? false : schema['x-requestbody'] === true,
    });
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

  const metadata = await readWriteMetadata(
    settings.output,
    Array.from(writtenFiles),
  );
  if (settings.cleanup !== false && writtenFiles.size > 0) {
    await cleanFiles(metadata.content, settings.output, [
      '/package.dart',
      '/**/index.dart',
      'pubspec.yaml',
      '/metadata.json',
    ]);
  }

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
  let inputName: string | undefined;
  let contentType = 'empty';
  let encode = '';
  let haveInput = false;
  for (const type in operation.requestBody.content) {
    const objectSchema = isRef(operation.requestBody.content[type].schema)
      ? followRef(spec, operation.requestBody.content[type].schema.$ref)
      : operation.requestBody.content[type].schema;
    const serializer = new DartSerializer(spec, (name, content) => {
      //
    });
    inputName = objectSchema['x-inputname'] as string;
    const serialized = serializer.handle(inputName, objectSchema, true, {
      alias: isObjectSchema(objectSchema) ? undefined : inputName,
      requestize: objectSchema['x-requestbody'] === true,
      noEmit: true,
    });
    encode = serialized.encode as string;
    const [mediaType, mediaSubType] = partContentType(type).type.split('/');
    if (mediaSubType === 'empty') {
      contentType = 'empty';
    } else if (mediaType === 'application') {
      contentType = parseJsonContentType(type) as string;
    } else {
      contentType = mediaType;
    }
    if (!isEmpty(objectSchema.properties)) {
      haveInput = true;
    }
  }
  if (!inputName) {
    throw new Error(
      `No input name found for operation ${operation.operationId} in ${entry.path}`,
    );
  }

  return { inputs, inputName, contentType, encode, haveInput };
}

function toOutput(spec: OpenAPIObject, operation: OperationObject) {
  const outputName = pascalcase(`${operation.operationId} output`);
  operation.responses ??= {};
  const outputs: Record<string, string> = {};
  for (const status in operation.responses) {
    const response = isRef(operation.responses[status] as ReferenceObject)
      ? followRef<ResponseObject>(spec, operation.responses[status].$ref)
      : (operation.responses[status] as ResponseObject);
    if (!isSuccessStatusCode(status)) continue;
    if (isEmpty(response.content)) continue;
    for (const type in response.content) {
      const { schema } = response.content[type];
      if (!schema) {
        console.warn(
          `Schema not found for ${type} in ${operation.operationId}`,
        );
        continue;
      }
      if ((response.headers ?? {})['Transfer-Encoding']) {
        return {
          type: 'stream',
          outputName,
          outputs,
          decode: `return stream`,
          returnType: `http.StreamedResponse`,
        };
      }
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
        const serializer = new DartSerializer(spec, (name, content) => {
          //
        });
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
  // default to stream. this should hanle transfer encoding chunked too.
  return {
    type: 'stream',
    outputName,
    outputs,
    decode: `return stream`,
    returnType: `http.StreamedResponse`,
  };
}
