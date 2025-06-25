import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { OpenAPIObject, OperationObject } from 'openapi3-ts/oas31';
import { snakecase } from 'stringcase';

import { isEmpty, isRef, pascalcase } from '@sdk-it/core';
import {
  type ReadFolderFn,
  type Writer,
  createWriterProxy,
  writeFiles,
} from '@sdk-it/core/file-system.js';
import {
  type OurOpenAPIObject,
  augmentSpec,
  cleanFiles,
  forEachOperation,
  isSuccessStatusCode,
  parseJsonContentType,
  readWriteMetadata,
} from '@sdk-it/spec';

import dispatcherTxt from './http/dispatcher.txt';
import interceptorsTxt from './http/interceptors.txt';
import responsesTxt from './http/responses.txt';
import { PythonEmitter } from './python-emitter.ts';

export async function generate(
  openapi: OpenAPIObject,
  settings: {
    output: string;
    cleanup?: boolean;
    name?: string;
    writer?: Writer;
    readFolder?: ReadFolderFn;
    /**
     * full: generate a full project including requirements.txt
     * minimal: generate only the client sdk
     */
    mode?: 'full' | 'minimal';
    formatCode?: (options: { output: string }) => void | Promise<void>;
  },
) {
  const spec = augmentSpec({ spec: openapi }, true);

  const clientName = settings.name || 'Client';
  const output = settings.output;
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
      className: string;
      methods: string[];
    }
  > = {};

  // Process each operation and group by tags
  forEachOperation(spec, (entry, operation) => {
    console.log(`Processing ${entry.method} ${entry.path}`);
    const group = (groups[entry.groupName] ??= {
      className: `${pascalcase(entry.groupName)}Api`,
      methods: [],
    });

    const input = toInputs(spec, { entry, operation });
    const response = toOutput(spec, operation);

    // Generate method for this operation
    const methodName = snakecase(
      operation.operationId ||
        `${entry.method}_${entry.path.replace(/[^a-zA-Z0-9]/g, '_')}`,
    );
    const returnType = response ? response.returnType : 'httpx.Response';

    const docstring =
      operation.summary || operation.description
        ? `        \"\"\"${operation.summary || operation.description}\"\"\"`
        : '';

    group.methods.push(`
    async def ${methodName}(self${input.haveInput ? `, input_data: ${input.inputName}` : ''}) -> ${returnType}:
${docstring}
        config = RequestConfig(
            method='${entry.method.toUpperCase()}',
            url='${entry.path}',
        )

        ${input.haveInput ? 'config = input_data.to_request_config(config)' : ''}

        response = await self.dispatcher.${input.contentType}(config)
        ${response ? `return await self.receiver.json(response, ${response.successModel || 'None'}, ${response.errorModel || 'None'})` : 'return response'}
    `);
  });

  // Generate models using the Python emitter
  const emitter = new PythonEmitter(spec);
  const models = await serializeModels(spec, emitter);

  // Generate API group classes
  const apiClasses = Object.entries(groups).reduce<Record<string, string>>(
    (acc, [name, { className, methods }]) => {
      const fileName = `api/${snakecase(name)}_api.py`;
      const imports = [
        'from typing import Optional',
        'import httpx',
        '',
        'from ..http.dispatcher import Dispatcher, RequestConfig',
        'from ..http.responses import Receiver',
        'from ..inputs import *',
        'from ..outputs import *',
        'from ..models import *',
        '',
      ].join('\n');

      acc[fileName] = `${imports}
class ${className}:
    \"\"\"API client for ${name} operations.\"\"\"

    def __init__(self, dispatcher: Dispatcher, receiver: Receiver):
        self.dispatcher = dispatcher
        self.receiver = receiver
${methods.join('\n')}
`;
      return acc;
    },
    {},
  );

  // Generate main client
  const apiImports = Object.keys(groups)
    .map(
      (name) =>
        `from .api.${snakecase(name)}_api import ${pascalcase(name)}Api`,
    )
    .join('\\n');

  const apiProperties = Object.keys(groups)
    .map(
      (name) =>
        `        self.${snakecase(name)} = ${pascalcase(name)}Api(dispatcher, receiver)`,
    )
    .join('\\n');

  const clientCode = `\"\"\"Main API client.\"\"\"

from typing import Optional, List
import httpx

${apiImports}
from .http.dispatcher import Dispatcher, RequestConfig
from .http.responses import Receiver
from .http.interceptors import (
    Interceptor,
    BaseUrlInterceptor,
    LoggingInterceptor,
    AuthInterceptor,
    UserAgentInterceptor,
)


class ${clientName}:
    \"\"\"Main API client for the SDK.\"\"\"

    def __init__(
        self,
        base_url: str,
        token: Optional[str] = None,
        api_key: Optional[str] = None,
        api_key_header: str = 'X-API-Key',
        enable_logging: bool = False,
        user_agent: Optional[str] = None,
        custom_interceptors: Optional[List[Interceptor]] = None,
    ):
        \"\"\"
        Initialize the API client.

        Args:
            base_url: Base URL for the API
            token: Bearer token for authentication
            api_key: API key for authentication
            api_key_header: Header name for API key authentication
            enable_logging: Enable request/response logging
            user_agent: Custom User-Agent header
            custom_interceptors: Additional custom interceptors
        \"\"\"
        self.base_url = base_url

        # Build interceptor chain
        interceptors = []

        # Base URL interceptor (always first)
        interceptors.append(BaseUrlInterceptor(base_url))

        # Authentication interceptor
        if token or api_key:
            interceptors.append(AuthInterceptor(token=token, api_key=api_key, api_key_header=api_key_header))

        # User agent interceptor
        if user_agent:
            interceptors.append(UserAgentInterceptor(user_agent))

        # Logging interceptor
        if enable_logging:
            interceptors.append(LoggingInterceptor())

        # Custom interceptors
        if custom_interceptors:
            interceptors.extend(custom_interceptors)

        # Initialize dispatcher and receiver
        self.dispatcher = Dispatcher(interceptors)
        self.receiver = Receiver(interceptors)

        # Initialize API clients
${apiProperties}

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self.close()

    async def close(self):
        \"\"\"Close the HTTP client.\"\"\"
        await self.dispatcher.close()
`;

  // Write all files
  await settings.writer(output, {
    ...models,
    ...apiClasses,
    'client.py': clientCode,
    'http/dispatcher.py': dispatcherTxt,
    'http/interceptors.py': interceptorsTxt,
    'http/responses.py': responsesTxt,
    '__init__.py': `\"\"\"SDK package.\"\"\"

from .client import ${clientName}

__all__ = ['${clientName}']
`,
  });

  // Generate requirements.txt if in full mode
  if (settings.mode === 'full') {
    const requirements = `# HTTP client
httpx>=0.24.0,<1.0.0

# Data validation and serialization
pydantic>=2.0.0,<3.0.0

# Enhanced type hints
typing-extensions>=4.0.0

# Optional: For better datetime handling
python-dateutil>=2.8.0
`;

    await settings.writer(output, {
      'requirements.txt': requirements,
    });
  }

  // Handle metadata and cleanup
  const metadata = await readWriteMetadata(
    settings.output,
    Array.from(writtenFiles),
  );

  if (settings.cleanup !== false && writtenFiles.size > 0) {
    await cleanFiles(metadata.content, settings.output, [
      '/__init__.py',
      'requirements.txt',
      '/metadata.json',
    ]);
  }

  // Generate __init__.py files for packages
  await settings.writer(output, {
    'models/__init__.py': await generateModuleInit(
      join(output, 'models'),
      settings.readFolder,
    ),
    'inputs/__init__.py': await generateModuleInit(
      join(output, 'inputs'),
      settings.readFolder,
    ),
    'outputs/__init__.py': await generateModuleInit(
      join(output, 'outputs'),
      settings.readFolder,
    ),
    'api/__init__.py': await generateModuleInit(
      join(output, 'api'),
      settings.readFolder,
    ),
    'http/__init__.py': `\"\"\"HTTP utilities.\"\"\"

from .dispatcher import Dispatcher, RequestConfig
from .interceptors import *
from .responses import *

__all__ = [
    'Dispatcher',
    'RequestConfig',
    'ApiResponse',
    'ErrorResponse',
    'Interceptor',
    'BaseUrlInterceptor',
    'LoggingInterceptor',
    'AuthInterceptor',
]
`,
  });

  // Run formatter if provided
  if (settings.formatCode) {
    await settings.formatCode({ output: settings.output });
  }
}

async function generateModuleInit(
  folder: string,
  readFolder: ReadFolderFn,
): Promise<string> {
  try {
    const files = await readFolder(folder);
    const pyFiles = files
      .filter(
        (file) =>
          file.fileName.endsWith('.py') && file.fileName !== '__init__.py',
      )
      .map((file) => file.fileName.replace('.py', ''));

    if (pyFiles.length === 0) {
      return '\"\"\"Package module.\"\"\"\n';
    }

    const imports = pyFiles.map((name) => `from .${name} import *`).join('\n');
    return `\"\"\"Package module.\"\"\"\n\n${imports}\n`;
  } catch {
    return '\"\"\"Package module.\"\"\"\\n';
  }
}

function toInputs(
  spec: OurOpenAPIObject,
  { entry, operation }: { entry: any; operation: OperationObject },
) {
  const inputName = (entry as any).inputName || 'Input';
  const haveInput =
    !isEmpty(operation.parameters) || !isEmpty(operation.requestBody);

  let contentType = 'json';
  if (operation.requestBody && !isRef(operation.requestBody)) {
    const content = operation.requestBody.content;
    if (content) {
      const contentTypes = Object.keys(content);
      if (contentTypes.some((type) => type.includes('multipart'))) {
        contentType = 'multipart';
      } else if (contentTypes.some((type) => type.includes('form'))) {
        contentType = 'form';
      }
    }
  }

  return {
    inputName,
    haveInput,
    contentType,
  };
}

function toOutput(spec: OurOpenAPIObject, operation: OperationObject) {
  if (!operation.responses) {
    return null;
  }

  // Find success response
  const successResponse = Object.entries(operation.responses).find(([code]) =>
    isSuccessStatusCode(Number(code)),
  );

  if (!successResponse) {
    return null;
  }

  const [statusCode, response] = successResponse;
  if (isRef(response)) {
    return null;
  }

  const content = response.content;
  if (!content) {
    return { returnType: 'None', successModel: null, errorModel: null };
  }

  // Find JSON content type
  const jsonContent = Object.entries(content).find(([type]) =>
    parseJsonContentType(type),
  );

  if (!jsonContent) {
    return {
      returnType: 'httpx.Response',
      successModel: null,
      errorModel: null,
    };
  }

  const [, mediaType] = jsonContent;
  const schema = (mediaType as any).schema;

  if (!schema || isRef(schema)) {
    return { returnType: 'Any', successModel: null, errorModel: null };
  }

  // Generate return type based on schema
  const emitter = new PythonEmitter(spec);
  const result = emitter.handle(schema, {});

  return {
    returnType: result.type || 'Any',
    successModel: result.type,
    errorModel: null, // TODO: Handle error models
  };
}

async function serializeModels(
  spec: OurOpenAPIObject,
  emitter: PythonEmitter,
): Promise<Record<string, string>> {
  const models: Record<string, string> = {};

  // Standard imports for all Python model files
  const standardImports = [
    'from typing import Any, Dict, List, Optional, Union, Literal',
    'from pydantic import BaseModel, Field',
    'from datetime import datetime, date',
    'from uuid import UUID',
    'from enum import Enum',
  ].join('\n');

  // Emit all schemas
  emitter.onEmit((name: string, content: string, schema: any) => {
    // Add imports to the content
    const fullContent = `${standardImports}
${schema['x-inputname'] ? 'from ..http.dispatcher import RequestConfig' : ''}


${content}`;

    if (schema['x-inputname']) {
      models[`inputs/${snakecase(name)}.py`] = fullContent;
    } else if (schema['x-response-name']) {
      models[`outputs/${snakecase(name)}.py`] = fullContent;
    } else {
      models[`models/${snakecase(name)}.py`] = fullContent;
    }
  });

  // Process all schemas in components
  if (spec.components?.schemas) {
    for (const [name, schema] of Object.entries(spec.components.schemas)) {
      if (!isRef(schema)) {
        emitter.handle(schema, { name });
      }
    }
  }

  return models;
}
