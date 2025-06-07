import { serve } from '@hono/node-server';
import { Octokit } from '@octokit/core';
import { randomBytes } from 'crypto';
import { Hono } from 'hono';
import { contextStorage } from 'hono/context-storage';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { logger as requestLogger } from 'hono/logger';
import { requestId } from 'hono/request-id';
import { streamText } from 'hono/streaming';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { cwd } from 'node:process';
import OpenAI from 'openai';
import type { OpenAPIObject } from 'openapi3-ts/oas31';
import pWaitFor from 'p-wait-for';
import { json } from 'stream/consumers';
import { z } from 'zod';

import { pascalcase } from '@sdk-it/core';
import * as tsDart from '@sdk-it/dart';
import { forEachOperation, loadSpec } from '@sdk-it/spec';
import { loadRemote } from '@sdk-it/spec';
import * as tsSdk from '@sdk-it/typescript';

import { talk } from './groq.js';
import { validate } from './middlewares/validator.js';

const app = new Hono().use(
  contextStorage(),
  requestLogger(),
  cors({ origin: '*' }),
  requestId(),
);

app.post('/', async (c) => {
  const { messages, id } = await c.req.json();
  const { specUrl } = c.req.query();
  const spec = await loadSpec(specUrl);
  return talk(spec, id, messages).toDataStreamResponse();
});

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
});

/**
 * @openai publish
 */
app.post(
  '/publish',
  validate((payload) => ({
    specUrl: {
      select: payload.body.specUrl,
      against: z.string().url(),
    },
  })),
  async (c) => {
    const specUrl = c.var.input.specUrl;
    const spec = await loadRemote<OpenAPIObject>(specUrl);
    // FIXME: should publish to a registry
    await tsSdk.generate(spec, {
      mode: 'full',
      name: 'SdkIt',
      output: join(process.cwd(), 'packages/client'),
      style: {
        errorAsValue: false,
      },
    });
    return c.json({
      message: 'SDK published successfully',
      specUrl,
    });
  },
);

/**
 * @openai annotate
 * @description Annotate the spec with additional information like code snippets, pagination, descriptions, examples, etc.
 * using LLM.
 */
app.post(
  '/augment',
  validate((payload) => ({
    specUrl: {
      select: payload.body.specUrl,
      against: z.string().url(),
    },
  })),
  async (c) => {
    throw new Error('Not implemented');
  },
);

app.post('/signed-url', async (c) => {
  // const cmd = new PutObjectCommand({
  //   Bucket: 'apiref',
  //   Key: 'path/to/uploaded-file.ext',
  //   ContentType: 'application/octet-stream',
  // });
  // // 3. Generate the presigned URL
  // const uploadUrl = await getSignedUrl(client, cmd, { expiresIn: 3600 });
  // console.log('Upload URL:', uploadUrl);
});

/**
 * @openai fetchSpec
 */

app.get(
  '/fetch',
  validate((payload) => ({
    url: {
      select: payload.query.url,
      against: z.string().url(),
    },
  })),
  async (c) => {
    return c.json((await loadSpec(c.var.input.url)) as any);
  },
);

/**
 * @openai generate
 */
app.post(
  '/generate',
  validate('multipart/form-data', (payload) => ({
    // specUrl: {
    //   select: payload.body.file,
    //   against: z.string(),
    // },
    specFile: {
      select: payload.body.specFile,
      against: z.instanceof(File).superRefine((file, ctx) => {
        if (file.type !== 'application/json') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'File must be a JSON file',
          });
          return false;
        }
        return true;
      }),
    },
  })),
  async (c) => {
    const spec = (await json(c.var.input.specFile.stream())) as OpenAPIObject;
    const files: { isFolder: boolean; filePath: string }[] = [];
    const sdkPath = join(tmpdir(), crypto.randomUUID());

    return streamText(c, async (stream) => {
      await tsSdk.generate(spec, {
        output: sdkPath,
        name: pascalcase(spec.info.title),
        writer: (dir, contents) => {
          Object.entries(contents).forEach(([file, content]) => {
            files.push({
              filePath: join(dir, file),
              isFolder: false,
            });
            stream.writeln(
              JSON.stringify({
                filePath: relative(sdkPath, join(dir, file)),
                content:
                  typeof content === 'string' ? content : content?.content,
                language: 'typescript',
              }),
            );
          });
          return Promise.resolve();
        },
        readFolder: async (folder) => {
          const folderFiles = files.filter((f) => {
            if (!f.filePath.startsWith(folder)) {
              return false;
            }
            // Ensure it's not the folder itself
            if (f.filePath === folder) {
              return false;
            }
            // Get path relative to the folder
            const relativePath = f.filePath.substring(folder.length + 1); // +1 for the separator
            // Direct children should not have any more separators in their relative path
            return !relativePath.includes('/') && !relativePath.includes('\\');
          });
          return folderFiles.map((file) => {
            const name =
              file.filePath.split('/').pop() ||
              file.filePath.split('\\').pop() ||
              '';
            return {
              fileName: name,
              filePath: file.filePath,
              isFolder: file.isFolder,
            };
          });
        },
      });
      await tsDart.generate(spec, {
        output: sdkPath,
        name: pascalcase(spec.info.title),
        writer: (dir, contents) => {
          Object.entries(contents).forEach(([file, content]) => {
            files.push({
              filePath: join(dir, file),
              isFolder: false,
            });
            stream.writeln(
              JSON.stringify({
                filePath: relative(sdkPath, join(dir, file)),
                content:
                  typeof content === 'string' ? content : content?.content,
                language: 'dart',
              }),
            );
          });
          return Promise.resolve();
        },
        readFolder: async (folder) => {
          const folderFiles = files.filter((f) => {
            if (!f.filePath.startsWith(folder)) {
              return false;
            }
            // Ensure it's not the folder itself
            if (f.filePath === folder) {
              return false;
            }
            // Get path relative to the folder
            const relativePath = f.filePath.substring(folder.length + 1); // +1 for the separator
            // Direct children should not have any more separators in their relative path
            return !relativePath.includes('/') && !relativePath.includes('\\');
          });
          return folderFiles.map((file) => {
            const name =
              file.filePath.split('/').pop() ||
              file.filePath.split('\\').pop() ||
              '';
            return {
              fileName: name,
              filePath: file.filePath,
              isFolder: file.isFolder,
            };
          });
        },
      });
      return stream.close();
      // for await (const file of glob(join(sdkPath, '**/*'), {
      //   withFileTypes: true,
      // })) {
      //   stream.writeln(
      //     JSON.stringify({
      //       fileName: relative(sdkPath, join(file.parentPath, file.name)),
      //       content: file.isDirectory()
      //         ? null
      //         : await readFile(join(file.parentPath, file.name), 'utf-8'),
      //     }),
      //   );
      // }
    });
    // return streamSSE(c, async (stream) => {
    //   for await (const file of glob(join(sdkPath, '**/*'))) {
    //     console.log(file);
    //     stream.writeSSE({
    //       data: file,
    //     });
    //   }
    // });
  },
);

/**
 * @openai playground
 * @tags playground
 */
app.post(
  '/playground',
  validate('multipart/form-data', (payload) => ({
    specFile: {
      select: payload.body.specFile,
      against: z.instanceof(File).superRefine((file, ctx) => {
        if (file.type !== 'application/json') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'File must be a JSON file',
          });
          return false;
        }
        return true;
      }),
    },
  })),
  async (c) => {
    // const base = randomDigits(6);
    // const url = await uploadFile(c.var.input.specFile, base);
    const url =
      'https://raw.githubusercontent.com/openai/openai-openapi/refs/heads/master/openapi.yaml';
    // const spec = (await json(c.var.input.specFile.stream())) as OpenAPIObject;
    const spec = (await loadSpec(url)) as OpenAPIObject;
    return c.json(
      {
        url: url,
        title: spec.info.title,
        name: `@${pascalcase(spec.info.title)}/sdk`,
        clientName: pascalcase(spec.info.title),
      },
      200,
    );
  },
);
/**
 * @openai operationsPagination
 * @tags operations
 */
app.get(
  '/operations',
  validate((payload) => ({
    page: {
      select: payload.query.page,
      against: z.coerce.number().int().min(1).default(1),
    },
    pageSize: {
      select: payload.query.pageSize,
      against: z.coerce.number().int().min(1).max(100).default(20),
    },
  })),
  async (c) => {
    const { page, pageSize } = c.var.input;

    const spec = await loadSpec(
      // 'https://raw.githubusercontent.com/openai/openai-openapi/refs/heads/master/openapi.yaml',
      join(cwd(), '.specs', 'hetzner.json'),
    );

    const operations = forEachOperation({ spec }, (entry, operation) => {
      return {
        operationId: operation.operationId,
        method: entry.method.toUpperCase(),
        path: entry.path,
        tag: entry.tag,
        summary: operation.summary,
        description: operation.description,
      };
    });

    // Calculate pagination values
    const totalItems = operations.length;
    const totalPages = Math.ceil(totalItems / pageSize);
    const startIndex = (page - 1) * pageSize;
    const endIndex = Math.min(startIndex + pageSize, totalItems);

    // Get paginated subset of operations
    const paginatedOperations = operations.slice(startIndex, endIndex);

    return c.json({
      operations: paginatedOperations.map(
        (operation) => `${operation.method} ${operation.path}`,
      ),
      pagination: {
        page,
        pageSize,
        totalItems,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    });
  },
);

app.onError((error, context) => {
  if (process.env.NODE_ENV === 'development') {
    console.error(error);
  }
  if (error instanceof HTTPException) {
    return context.json(
      {
        error: error.message,
        cause: error.cause,
      },
      error.status,
    );
  }
  return context.json(
    {
      error: 'Internal Server Error',
      cause: process.env.NODE_ENV === 'development' ? error : undefined,
    },
    500,
  );
});
serve(app, async (addressInfo) => {
  console.log(`Server is running on http://localhost:${addressInfo.port}`);
});

function randomDigits(length = 6): string {
  return Array.from(randomBytes(length))
    .map((b) => (b % 10).toString())
    .join('');
}

const openai = new OpenAI();
const page = await openai.vectorStores.list();

const owner = 'JanuaryLabs';
const repo = 'sdk-it';
const workflow_id = 'play.yml';
const ref = 'main';

async function triggerAndTrack(
  base: string,
  spec_url: string,
  onTrack: (status: string | null, conclusion: string | null) => void,
) {
  // 1. Dispatch the workflow
  await octokit.request(
    'POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches',
    { owner, repo, workflow_id, ref, inputs: { base, spec_url } },
  );

  // 2. Find the latest run ID
  const { data: runsData } = await octokit.request(
    'GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs?event=workflow_dispatch&branch={ref}&per_page=1',
    { owner, repo, workflow_id, ref },
  );
  const runId = runsData.workflow_runs[0].id;

  // 3. Poll until the run completes
  const run = await pWaitFor(
    async () => {
      const { data: runData } = await octokit.request(
        'GET /repos/{owner}/{repo}/actions/runs/{run_id}',
        { owner, repo, run_id: runId },
      );
      onTrack(runData.status, runData.conclusion);
      console.log(`Status: ${runData.status}`); // status can be queued, in_progress, completed :contentReference[oaicite:3]{index=3}
      return runData.status === 'completed';
    },
    {
      interval: 5000, // 5s between checks
      timeout: 3 * 60e3, // give up after 3 minutes
    },
  );

  // 4. Fetch final conclusion
  const { data: finalRun } = await octokit.request(
    'GET /repos/{owner}/{repo}/actions/runs/{run_id}',
    { owner, repo, run_id: runId },
  );
  console.log(`Workflow finished with conclusion: ${finalRun.conclusion}`);
  return finalRun;
}
