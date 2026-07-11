import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const markdownFiles = execFileSync('git', ['ls-files', '*.md'], {
  encoding: 'utf8',
})
  .trim()
  .split('\n')
  .filter(Boolean);

const failures = [];
const linkPattern = /!?\[[^\]]*\]\(([^)]+)\)/gu;

for (const file of markdownFiles) {
  const content = readFileSync(file, 'utf8');
  for (const match of content.matchAll(linkPattern)) {
    const rawTarget = match[1].trim().replace(/^<|>$/gu, '');
    if (
      !rawTarget ||
      rawTarget.startsWith('#') ||
      /^[a-z][a-z\d+.-]*:/iu.test(rawTarget)
    ) {
      continue;
    }

    const path = decodeURIComponent(rawTarget.split('#', 1)[0]);
    const target = resolve(dirname(file), path);
    if (!existsSync(target)) {
      failures.push(`${file}: missing ${rawTarget}`);
      continue;
    }

    if (rawTarget.endsWith('/') && !statSync(target).isDirectory()) {
      failures.push(`${file}: expected directory ${rawTarget}`);
    }
  }
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log('All relative Markdown links resolve.');
}
