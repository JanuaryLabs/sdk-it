import { serve } from '@hono/node-server';
import { Octokit } from '@octokit/core';
import { randomBytes } from 'crypto';
import { Hono } from 'hono';
import { contextStorage } from 'hono/context-storage';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { logger as requestLogger } from 'hono/logger';
import { requestId } from 'hono/request-id';
import { streamSSE } from 'hono/streaming';
import { Client } from 'minio';
import type { OpenAPIObject } from 'openapi3-ts/oas31';
import pWaitFor from 'p-wait-for';
import { buffer, json } from 'stream/consumers';
import { z } from 'zod';

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
    const base = randomDigits(6);
    console.log('Received file:', c.var.input.specFile);
    const spec = (await json(c.var.input.specFile.stream())) as OpenAPIObject;
    const url = await uploadFile(c.var.input.specFile, base);

    // // await t.generate(spec, {});
    // // await d.generate(spec, {});
    // return c.json({
    //   url: url,
    //   title: spec.info.title,
    // });
    return streamSSE(c, async (stream) => {
      await triggerAndTrack(base, url, (status, conclusion) => {
        console.log(`Status: ${status}`);
        console.log(`Conclusion: ${conclusion}`);
        stream.writeSSE({
          data: JSON.stringify({ status, conclusion }),
          event: 'workflow-status',
          id: base,
        });
      });
      //   while (true) {
      //   const message = `It is ${new Date().toISOString()}`;
      //   await stream.writeSSE({
      //     data: message,
      //     event: 'time-update',
      //     id: base,
      //   });
      //   await stream.sleep(1000);
      // }
    });
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
