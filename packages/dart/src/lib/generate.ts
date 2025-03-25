import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { npmRunPathEnv } from 'npm-run-path';
import type { OpenAPIObject } from 'openapi3-ts/oas31';
import { camelcase, pascalcase, spinalcase } from 'stringcase';

import { forEachOperation, writeFiles } from '@sdk-it/core';

import interceptors from './interceptors.txt';

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
    formatCode?: (options: {
      output: string;
      env: ReturnType<typeof npmRunPathEnv>;
    }) => void | Promise<void>;
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
  forEachOperation({ spec }, (entry, operation) => {
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

  const clazzez = Object.entries(groups).reduce<Record<string, string>>(
    (acc, [name, { methods }]) => {
      return {
        ...acc,
        [`api/${spinalcase(name)}.dart`]: `
        import 'dart:convert';
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

  console.dir({ groups }, { depth: null });

  const client = `
import './interceptors.dart';
import './http.dart';
${Object.keys(groups)
  .map((name) => `import './api/${spinalcase(name)}.dart';`)
  .join('\n')}

  class Client {
  final Options options;
${Object.keys(groups)
  .map((name) => `late final ${pascalcase(name)} ${camelcase(name)};`)
  .join('\n')}

  Client(this.options) {
    final interceptors = [new BaseUrlInterceptor(() => this.options.baseUrl)];

    ${Object.keys(groups)
      .map(
        (name) =>
          `this.${camelcase(name)} = new ${pascalcase(name)}(new Dispatcher(interceptors));`,
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

  execSync('dart format .', { cwd: output });
}
