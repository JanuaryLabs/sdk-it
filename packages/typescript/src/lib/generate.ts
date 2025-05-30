import { template } from 'lodash-es';
import { readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { npmRunPathEnv } from 'npm-run-path';
import type { OpenAPIObject } from 'openapi3-ts/oas31';
import { spinalcase } from 'stringcase';

import { methods, pascalcase } from '@sdk-it/core';
import {
  type WriteContent,
  addLeadingSlash,
  exist,
  getFolderExports,
  readFolder,
  writeFiles,
} from '@sdk-it/core/file-system.js';
import { toReadme } from '@sdk-it/readme';
import { augmentSpec } from '@sdk-it/spec';

import backend from './client.ts';
import { generateCode } from './generator.ts';
import dispatcherTxt from './http/dispatcher.txt';
import interceptors from './http/interceptors.txt';
import parseResponse from './http/parse-response.txt';
import parserTxt from './http/parser.txt';
import requestTxt from './http/request.txt';
import responseTxt from './http/response.txt';
import type { TypeScriptGeneratorOptions } from './options.ts';
import cursorPaginationTxt from './paginations/cursor-pagination.txt';
import offsetPaginationTxt from './paginations/offset-pagination.txt';
import paginationTxt from './paginations/page-pagination.txt';
import { generateInputs } from './sdk.ts';
import { TypeScriptGenerator } from './typescript-snippet.ts';
import { exclude, securityToOptions } from './utils.ts';

function security(spec: OpenAPIObject) {
  const security = spec.security || [];
  const components = spec.components || {};
  const securitySchemes = components.securitySchemes || {};
  const paths = Object.values(spec.paths ?? {});

  const options = securityToOptions(spec, security, securitySchemes);

  for (const it of paths) {
    for (const method of methods) {
      const operation = it[method];
      if (!operation) {
        continue;
      }
      Object.assign(
        options,
        securityToOptions(
          spec,
          operation.security || [],
          securitySchemes,
          'input',
        ),
      );
    }
  }
  return options;
}
const ALWAYS_AVAILABLE_FILES = [
  '/tsconfig*.json',
  '/package.json',
  '/metadata.json',
  '/**/index.ts',
];

export async function generate(
  spec: OpenAPIObject,
  settings: TypeScriptGeneratorOptions,
) {
  const { default: micromatch } = await import('micromatch');
  spec = 'x-sdk-augmented' in spec ? spec : augmentSpec({ spec });
  const generator = new TypeScriptGenerator(spec, settings);
  const style = Object.assign(
    {},
    {
      errorAsValue: false,
      name: 'github',
      outputType: 'default',
    },
    settings.style ?? {},
  );
  const output =
    settings.mode === 'full' ? join(settings.output, 'src') : settings.output;

  settings.useTsExtension ??= true;
  // FIXME: there should not be default here
  // instead export this function from the cli package with
  // defaults for programmatic usage
  const writtenFiles = new Set<string>();
  settings.writer ??= writeFiles;
  const originalWriter = settings.writer;
  settings.writer = async (dir: string, contents: WriteContent) => {
    await originalWriter(dir, contents);
    for (const file of Object.keys(contents)) {
      if (contents[file] !== null) {
        writtenFiles.add(
          addLeadingSlash(`${relative(settings.output, dir)}/${file}`),
        );
      }
    }
  };
  settings.readFolder ??= async (folder: string) => {
    const files = await readdir(folder, { withFileTypes: true });
    return files.map((file) => ({
      fileName: file.name,
      filePath: join(file.parentPath, file.name),
      isFolder: file.isDirectory(),
    }));
  };
  const makeImport = (moduleSpecifier: string) => {
    return settings.useTsExtension ? `${moduleSpecifier}.ts` : moduleSpecifier;
  };
  const { commonSchemas, endpoints, groups, outputs, commonZod } = generateCode(
    {
      spec,
      style,
      makeImport,
    },
  );
  const options = security(spec);
  const clientName = pascalcase((settings.name || 'client').trim());

  const packageName = settings.name
    ? `@${spinalcase(settings.name.trim().toLowerCase())}/sdk`
    : 'sdk';

  // FIXME: inputs, outputs should be generated before hand.
  const inputFiles = generateInputs(groups, commonZod, makeImport);

  await settings.writer(output, {
    'outputs/.gitkeep': '',
    'inputs/.gitkeep': '',
    'models/.getkeep': '',
  });

  await settings.writer(join(output, 'http'), {
    'parse-response.ts': parseResponse,
    'response.ts': responseTxt,
    'parser.ts': parserTxt,
    'request.ts': requestTxt,
    'dispatcher.ts': `import z from 'zod';
import { type Interceptor } from '${makeImport('../http/interceptors')}';
import { type RequestConfig } from '${makeImport('../http/request')}';
import { buffered } from '${makeImport('./parse-response')}';
import { APIError, APIResponse, type SuccessfulResponse, type ProblematicResponse } from '${makeImport('./response')}';

${template(dispatcherTxt, {})({ throwError: !style.errorAsValue, outputType: style.outputType })}`,

    'interceptors.ts': `
    import type { RequestConfig, HeadersInit } from './${makeImport('request')}';
    ${interceptors}`,
  });

  await settings.writer(join(output, 'outputs'), outputs);
  const modelsImports = Object.entries(commonSchemas).map(([name]) => name);
  await settings.writer(output, {
    'client.ts': backend(
      {
        name: clientName,
        servers: (spec.servers ?? []).map((server) => server.url) || [],
        options: options,
        makeImport,
      },
      style,
    ),
    ...inputFiles,
    ...endpoints,
    ...Object.fromEntries(
      Object.entries(commonSchemas).map(([name, schema]) => [
        `models/${name}.ts`,
        [
          `import { z } from 'zod';`,
          ...exclude(modelsImports, [name]).map(
            (it) => `import type { ${it} } from './${it}.ts';`,
          ),
          `export type ${name} = ${schema};`,
        ].join('\n'),
      ]),
    ),
  });

  await settings.writer(join(output, 'pagination'), {
    'cursor-pagination.ts': cursorPaginationTxt,
    'offset-pagination.ts': offsetPaginationTxt,
    'page-pagination.ts': paginationTxt,
  });

  const metadata = await readJson(join(settings.output, 'metadata.json'));
  metadata.content.generatedFiles = Array.from(writtenFiles);
  metadata.content.userFiles ??= ['/dist/**', '/build/**', '/readme.md'];
  await metadata.write(metadata.content);

  if (settings.cleanup !== false && metadata.content.generatedFiles) {
    const generated = metadata.content.generatedFiles as string[];
    const user = metadata.content.userFiles as string[];
    const keep = [...generated, ...user, ...ALWAYS_AVAILABLE_FILES];
    const actualFiles = await readFolder(settings.output, true);
    for (const file of actualFiles) {
      if (micromatch.isMatch(addLeadingSlash(file), keep)) {
        continue;
      }
      const filePath = join(settings.output, file);
      await unlink(filePath);
    }
  }

  const folders = [
    getFolderExports(
      join(output, 'outputs'),
      settings.readFolder,
      settings.useTsExtension,
    ),
    getFolderExports(
      join(output, 'inputs'),
      settings.readFolder,
      settings.useTsExtension,
      ['ts'],
      (dirent) => dirent.isFolder && ['schemas'].includes(dirent.fileName),
    ),
    getFolderExports(
      join(output, 'api'),
      settings.readFolder,
      settings.useTsExtension,
    ),
    getFolderExports(
      join(output, 'http'),
      settings.readFolder,
      settings.useTsExtension,
      ['ts'],
      (dirent) => !['response.ts', 'parser.ts'].includes(dirent.fileName),
    ),
  ];
  if (modelsImports.length) {
    folders.push(
      getFolderExports(
        join(output, 'models'),
        settings.readFolder,
        settings.useTsExtension,
      ),
    );
  }
  const [outputIndex, inputsIndex, apiIndex, httpIndex, modelsIndex] =
    await Promise.all(folders);

  await settings.writer(join(output, 'pagination'), {
    'index.ts': await getFolderExports(
      join(output, 'pagination'),
      settings.readFolder,
      settings.useTsExtension,
      ['ts'],
    ),
  });
  await settings.writer(output, {
    'api/index.ts': apiIndex,
    'outputs/index.ts': outputIndex,
    'inputs/index.ts': inputsIndex || null,
    'http/index.ts': httpIndex,
    ...(modelsImports.length ? { 'models/index.ts': modelsIndex } : {}),
  });
  await settings.writer(output, {
    'index.ts': await getFolderExports(
      output,
      settings.readFolder,
      settings.useTsExtension,
      ['ts'],
      (config) => config.fileName.endsWith('pagination'),
    ),
  });
  if (settings.mode === 'full') {
    const configFiles: WriteContent = {
      'package.json': {
        ignoreIfExists: true,
        content: JSON.stringify(
          {
            name: packageName,
            version: '0.0.1',
            type: 'module',
            main: './src/index.ts',
            module: './src/index.ts',
            types: './src/index.ts',
            publishConfig: {
              access: 'public',
            },
            exports: {
              './package.json': './package.json',
              '.': {
                types: './src/index.ts',
                import: './src/index.ts',
                default: './src/index.ts',
              },
            },
            dependencies: {
              'fast-content-type-parse': '^3.0.0',
              zod: '^3.24.2',
            },
          },
          null,
          2,
        ),
      },
      'tsconfig.json': {
        ignoreIfExists: true,
        content: JSON.stringify(
          {
            compilerOptions: {
              skipLibCheck: true,
              skipDefaultLibCheck: true,
              target: 'ESNext',
              module: 'ESNext',
              noEmit: true,
              strict: true,
              allowImportingTsExtensions: true,
              verbatimModuleSyntax: true,
              baseUrl: '.',
              moduleResolution: 'bundler',
            },
            include: ['**/*.ts'],
          },
          null,
          2,
        ),
      },
    };
    if (settings.readme) {
      configFiles['README.md'] = {
        ignoreIfExists: false,
        content: toReadme(spec, {
          generateSnippet: (...args) => generator.snippet(...args),
        }),
      };
    }
    await settings.writer(settings.output, configFiles);
  }

  await settings.formatCode?.({
    output: output,
    env: npmRunPathEnv(),
  });
}

export async function readJson(path: string) {
  const content = (await exist(path))
    ? JSON.parse(await readFile(path, 'utf-8'))
    : {};
  return {
    content,
    write: (value: Record<string, any> = content) =>
      writeFile(path, JSON.stringify(value, null, 2), 'utf-8'),
  };
}
