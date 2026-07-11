import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';

const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
  .trim()
  .split('\n')
  .filter(Boolean);

const failures = [];
for (const file of files) {
  if (!existsSync(file)) continue;
  try {
    const content = readFileSync(file, 'utf8');
    if (file.endsWith('.json')) JSON.parse(content);
    if (/\.ya?ml$/u.test(file)) parseYaml(content);
  } catch (error) {
    failures.push(`${file}: ${error.message}`);
  }
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log('All tracked JSON and YAML files are valid.');
}
