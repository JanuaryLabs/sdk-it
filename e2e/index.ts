import { execSync } from 'child_process';
import { dirname, join } from 'path';

const __filename = new URL(import.meta.url).pathname;
const __dirname = dirname(__filename);

const nodeExec = 'node --experimental-strip-types';
const cliPath = './packages/cli/src/index.ts';
const sdkInput = join(__dirname, './openai.yaml');
const sdkOutput = './.client';
const sdkFlags = [
  `-s ${sdkInput}`,
  `-o ${sdkOutput}`,
  '--formatter "prettier $SDK_IT_OUTPUT --write"',
  '--name OpenAI',
  '--mode full',
];

// Generate the SDK
execSync(`${nodeExec} ${cliPath} ${sdkFlags.join(' ')}`, {
  encoding: 'utf-8',
  stdio: 'inherit',
});

// Run type checking
execSync(`./node_modules/.bin/tsc -p ${sdkOutput}/tsconfig.json`, {
  encoding: 'utf-8',
  stdio: 'inherit',
});

// Node runtime
execSync(`${nodeExec} ${join(sdkOutput, 'src/index.ts')}`, {
  encoding: 'utf-8',
  stdio: 'inherit',
});

// Bun runtime
execSync(`$bun ${join(sdkOutput, 'src/index.ts')}`, {
  encoding: 'utf-8',
  stdio: 'inherit',
});

// Todo: test it in browser env by using libdom
