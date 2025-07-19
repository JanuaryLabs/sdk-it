import { execSync } from 'child_process';
import { join } from 'node:path';


const projects = [
  'cli',
  'core',
  'dart',
  'generic',
  'hono',
  'readme',
  'spec',
  'typescript',
  'rpc'
];
for (const project of [...projects]) {
  const dir = join(process.cwd(), 'packages', project);
  execSync(`npm link --force`, { cwd: dir });
  console.log(`Linked ${project}`);
}

console.log(`Link command: "npm link @sdk-it/{${projects.join(',')}}"`);