import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import ts from 'typescript';

import { writeFiles } from '@sdk-it/core/file-system.js';

/**
 * Compile a temporary TypeScript project and return diagnostics.
 */
async function compileProject(files: Record<string, string>) {
	const dir = join(tmpdir(), 'sdk-it-type-test', crypto.randomUUID());
	await writeFiles(dir, files);
	const configPath = join(dir, 'tsconfig.json');

	const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
	const parsedConfig = ts.parseJsonConfigFileContent(
		configFile.config,
		ts.sys,
		dir,
	);

	const program = ts.createProgram(
		parsedConfig.fileNames,
		parsedConfig.options,
	);
	const diagnostics = ts.getPreEmitDiagnostics(program);

	await rm(dir, { recursive: true, force: true });

	return diagnostics.map((d) => ({
		message: ts.flattenDiagnosticMessageText(d.messageText, '\n'),
		file: d.file?.fileName,
		line: d.file && d.start !== undefined
			? d.file.getLineAndCharacterOfPosition(d.start).line + 1
			: undefined,
	}));
}

describe('RebindSuccessPayload type correctness', () => {
	test('preserves per-status-code generics instead of collapsing to union', async () => {
		const diagnostics = await compileProject({
			'tsconfig.json': JSON.stringify({
				compilerOptions: {
					target: 'ES2022',
					module: 'ESNext',
					moduleResolution: 'bundler',
					strict: true,
					skipLibCheck: true,
					noEmit: true,
				},
				include: ['*.ts'],
			}),
			'test.ts': `
// Minimal reproduction of the response type system
class APIResponse<Body = unknown, Status extends number = number> {
  static readonly status: number;
  readonly status: Status;
  data: Body;
  readonly headers: Headers;
  constructor(status: Status, headers: Headers, data: Body) {
    this.status = status;
    this.headers = headers;
    this.data = data;
  }
  static create<Body = unknown>(status: number, headers: Headers, data: Body) {
    return new this(status, headers, data);
  }
}

class Ok<T> extends APIResponse<T, 200> {
  static override readonly status = 200 as const;
  constructor(headers: Headers, data: T) { super(200, headers, data); }
  static override create<T>(status: number, headers: Headers, data: T) {
    return new this(headers, data);
  }
}

class Created<T> extends APIResponse<T, 201> {
  static override readonly status = 201 as const;
  constructor(headers: Headers, data: T) { super(201, headers, data); }
  static override create<T>(status: number, headers: Headers, data: T) {
    return new this(headers, data);
  }
}

type SuccessfulResponse<T = unknown> = Ok<T> | Created<T>;

type RebindSuccessPayload<Resp, New> =
  Resp extends Ok<infer _>
    ? Ok<New>
    : Resp extends Created<infer _>
      ? Created<New>
      : never;

// --- Dispatcher types ---

interface Type<T> {
  new (...args: any[]): T;
}

type OutputType = Type<APIResponse> | { parser: any; type: Type<APIResponse> };

type Unionize<T> = T extends [infer Single extends OutputType]
  ? InstOf<Single>
  : T extends readonly [...infer Tuple extends OutputType[]]
    ? { [I in keyof Tuple]: InstOf<Tuple[I]> }[number]
    : never;

type InstOf<T> =
  T extends Type<infer U>
    ? U
    : T extends { type: Type<infer U> }
      ? U
      : T extends Array<unknown>
        ? Unionize<T>
        : never;

type ResponseData<T extends OutputType[]> =
  Extract<Unionize<T>, SuccessfulResponse> extends SuccessfulResponse<infer P>
    ? P
    : unknown;

type ResponseMapper<T extends OutputType[], R> = (data: ResponseData<T>) => R;

// --- parse overloads (mirrors dispatcher.txt) ---

declare function parse<T extends OutputType[]>(
  outputs: T,
  response: Response,
): Promise<Extract<Unionize<T>, SuccessfulResponse<unknown>>>;
declare function parse<T extends OutputType[], R>(
  outputs: T,
  response: Response,
  mapper: ResponseMapper<T, R>,
): Promise<RebindSuccessPayload<Extract<Unionize<T>, SuccessfulResponse<unknown>>, R>>;

// --- send overloads (mirrors Dispatcher.send in dispatcher.txt) ---

declare function send<T extends OutputType[]>(
  outputs: T,
  signal?: AbortSignal,
): Promise<Extract<Unionize<T>, SuccessfulResponse<unknown>>>;
declare function send<T extends OutputType[], R>(
  outputs: T,
  signal: AbortSignal | undefined,
  mapper: ResponseMapper<T, R>,
): Promise<RebindSuccessPayload<Extract<Unionize<T>, SuccessfulResponse<unknown>>, R>>;

// --- Test types ---

type TypeA = { a: string };
type TypeB = { b: number };

type Outputs = [typeof Ok<TypeA>, typeof Created<TypeB>];

declare const outputs: Outputs;
declare const response: Response;

// Test 1: parse without mapper — preserves per-status-code types
async function testParseNoMapper() {
  const result = await parse(outputs, response);
  if (result instanceof Ok) {
    const narrowed: TypeA = result.data;
  }
  if (result instanceof Created) {
    const narrowed: TypeB = result.data;
  }
}

// Test 2: parse with mapper — rebinds all wrappers to mapped type
async function testParseWithMapper() {
  const result = await parse(outputs, response, (_data) => 'mapped');
  const s: string = result.data;
}

// Test 3: send without mapper — same as parse, preserves per-status types
async function testSendNoMapper() {
  const result = await send(outputs);
  if (result instanceof Ok) {
    const narrowed: TypeA = result.data;
  }
  if (result instanceof Created) {
    const narrowed: TypeB = result.data;
  }
}

// Test 4: send with mapper — rebinds all wrappers to mapped type
async function testSendWithMapper() {
  const result = await send(outputs, undefined, (_data) => ({ mapped: true }));
  const m: { mapped: boolean } = result.data;
}

// Test 5: single status code — no collapse possible, both paths work
type SingleOutputs = [typeof Ok<TypeA>];
declare const singleOutputs: SingleOutputs;

async function testSingleStatus() {
  const result = await parse(singleOutputs, response);
  // Only Ok is possible, data should be TypeA
  const d: TypeA = result.data;
}

// Test 6: mapper with narrowed return — type narrows correctly
async function testMapperNarrows() {
  const result = await parse(outputs, response, (data) => {
    return { transformed: true as const };
  });
  const t: { transformed: true } = result.data;
}
`,
		});

		assert.strictEqual(
			diagnostics.length,
			0,
			`Expected zero type errors but got ${diagnostics.length}:\n${diagnostics.map((d) => `  line ${d.line}: ${d.message}`).join('\n')}`,
		);
	});
});
