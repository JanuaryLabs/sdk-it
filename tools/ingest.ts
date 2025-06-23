#!/usr/bin/env ts-node-esm
import { exec } from 'child_process';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { promisify } from 'util';

const asyncExec = promisify(exec);

const excludeFiles = [
  'contributing.md',
  'prompt.md',
  'combined.txt',
  'ingest.ts',
];
const excludeDirs = [
  'apps/api/',
  'apps/www/',
  'archive/',
  'packages/apiref/app/shadcn/',
  '.github/',
];
const OUTPUT_FILE = 'combined.txt';

// Grab all relevant files from Git
const { stdout } = await asyncExec(
  'git ls-files --cached --others --exclude-standard',
);

// Split lines and filter for our desired extensions
const lines = stdout
  .split(/\r?\n/)
  .filter(
    (line) =>
      line &&
      /\.(ts|txt|md|mdx)$/.test(line) &&
      !excludeDirs.some((dir) => line.startsWith(dir)) &&
      !excludeFiles.some((it) => line.toLowerCase().endsWith(it.toLowerCase())),
  );

// Clear or create output file
await writeFile(OUTPUT_FILE, '', 'utf-8');

// Append each file's content
for (const filePath of lines) {
  const content = await readFile(filePath, 'utf-8');
  await appendFile(OUTPUT_FILE, `===== ${filePath} =====\n${content}\n\n`);
}
