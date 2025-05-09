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
import { Client } from 'minio';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import type { OpenAPIObject } from 'openapi3-ts/oas31';
import pWaitFor from 'p-wait-for';
import { buffer, json } from 'stream/consumers';
import { z } from 'zod';

import { pascalcase } from '@sdk-it/core';
import * as tsDart from '@sdk-it/dart';
import { loadRemote } from '@sdk-it/spec/loaders/remote-loader.js';
import * as tsSdk from '@sdk-it/typescript';

import { talk } from './groq.js';
import { validate } from './middlewares/validator.js';

export const minio = new Client({
  endPoint: 'fsn1.your-objectstorage.com',
  port: 443,
  useSSL: true,
  accessKey: 'H3ND25VTX3ZWXFSTJVYH',
  secretKey: 'aNqWDOj2cF6YVhnWMC2WBNPg8Ih0KrjsolEzTFQT',
  region: 'eu-central',
});

const app = new Hono().use(
  contextStorage(),
  requestLogger(),
  cors({ origin: '*' }),
  requestId(),
);

app.post('/', async (c) => {
  const { messages, id } = await c.req.json();
  const r = talk(id, messages);
  return r.toDataStreamResponse();
});

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
});

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
    return c.json((await loadRemote(c.var.input.url)) as any);
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
    const spec = await loadRemote(url) as OpenAPIObject
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

async function uploadFile(file: File, name: string) {
  const bucket = 'apiref';
  const fileName = `specs/${name}.json`;
  await minio.putObject(
    bucket,
    fileName,
    await buffer(file.stream()),
    undefined,
    { 'Content-Type': file.type },
  );
  return `https://fsn1.your-objectstorage.com/${bucket}/${fileName}`;
}

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
serve(app, (addressInfo) => {
  console.log(`Server is running on http://localhost:${addressInfo.port}`);
});

function randomDigits(length = 6): string {
  return Array.from(randomBytes(length))
    .map((b) => (b % 10).toString())
    .join('');
}

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
