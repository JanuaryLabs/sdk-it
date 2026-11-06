import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import { typecheck, workspaceDirectory } from '@sdk-it/testing';

test('parse and send keep each status code its payload type, and a mapper rebinds every success class', async () => {
  await using workspace = await workspaceDirectory('runtime-response-types-');
  await writeFile(
    join(workspace.path, 'consumer.ts'),
    `import { Created, Dispatcher, Ok, parse, type RequestConfig } from '@sdk-it/runtime';

type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;

type TypeA = { a: string };
type TypeB = { b: number };
declare const outputs: [typeof Ok<TypeA>, typeof Created<TypeB>];
declare const singleOutputs: [typeof Ok<TypeA>];
declare const response: Response;
declare const config: RequestConfig;
declare const dispatcher: Dispatcher;

export async function checks() {
  const parsed = await parse(outputs, response);
  const parsedKeepsEachStatus: Equal<typeof parsed, Ok<TypeA> | Created<TypeB>> = true;

  const parsedMapped = await parse(outputs, response, () => 'mapped');
  const parseRebindsEveryClass: Equal<typeof parsedMapped, Ok<string> | Created<string>> = true;

  const sent = await dispatcher.send(config, outputs);
  const sendKeepsEachStatus: Equal<typeof sent, Ok<TypeA> | Created<TypeB>> = true;

  const sentMapped = await dispatcher.send(config, outputs, undefined, () => ({ mapped: true }));
  const sendRebindsEveryClass: Equal<
    typeof sentMapped,
    Ok<{ mapped: boolean }> | Created<{ mapped: boolean }>
  > = true;

  const single = await parse(singleOutputs, response);
  const singleStatus: Equal<typeof single, Ok<TypeA>> = true;

  const narrowed = await parse(outputs, response, () => ({ transformed: true as const }));
  const mapperNarrows: Equal<
    typeof narrowed,
    Ok<{ transformed: true }> | Created<{ transformed: true }>
  > = true;

  return [
    parsedKeepsEachStatus,
    parseRebindsEveryClass,
    sendKeepsEachStatus,
    sendRebindsEveryClass,
    singleStatus,
    mapperNarrows,
  ];
}
`,
  );

  const { files, diagnostics } = typecheck({
    tsconfig: {
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'bundler',
        strict: true,
        noEmit: true,
      },
      include: ['consumer.ts'],
    },
    directory: workspace.path,
  });

  assert.ok(files.some((file) => file.endsWith('consumer.ts')));
  assert.deepStrictEqual(diagnostics, []);
});
