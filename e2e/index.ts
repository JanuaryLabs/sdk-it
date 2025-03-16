import chalk from 'chalk';
import { execSync } from 'child_process';
import { join } from 'path';

function runCommand(title: string, command: string) {
  const width = process.stdout.columns || 80;
  const divider = '='.repeat(width);

  // Print header
  console.log('\n' + chalk.blue(divider));
  console.log(chalk.bgBlue.white.bold(` ${title} `));
  console.log(chalk.blue(divider) + '\n');

  // Run the command and let errors propagate naturally
  console.log(chalk.dim(`$ ${command}`));
  execSync(command, {
    encoding: 'utf-8',
    stdio: 'inherit',
  });

  // Show success message if execution completes
  console.log('\n' + chalk.green(`✓ ${title} completed successfully`) + '\n');
}

const specs = [
  {
    spec: 'https://raw.githubusercontent.com/openai/openai-openapi/refs/heads/master/openapi.yaml',
    name: 'openai',
  },
  {
    spec: 'https://raw.githubusercontent.com/figma/rest-api-spec/refs/heads/main/openapi/openapi.yaml',
    name: 'figma',
  },
  { spec: 'https://docs.hetzner.cloud/spec.json', name: 'hetzner' },
];

for (const { spec, name } of specs) {
  console.log('\n' + chalk.magenta('='.repeat(80)));
  console.log(chalk.magenta.bold(`RUNNING TEST SUITE FOR: ${spec}`));
  console.log(chalk.magenta('='.repeat(80)) + '\n');

  const nodeExec = 'node --experimental-strip-types';
  const cliPath = './packages/cli/src/index.ts';

  const sdkOutput = `./.client-${name}`;
  const sdkFlags = [
    `-s ${spec}`,
    `-o ${sdkOutput}`,
    '--formatter "prettier $SDK_IT_OUTPUT --write"',
    `--name ${name}`,
    '--mode full',
  ];

  // Generate SDK
  runCommand(
    `GENERATING SDK: ${name}`,
    `${nodeExec} ${cliPath} ${sdkFlags.join(' ')}`,
  );

  // Run type checking with Node environment
  runCommand(
    `TYPE CHECKING: ${name}`,
    `./node_modules/.bin/tsc -p ${sdkOutput}/tsconfig.json`,
  );

  // Test with Bun runtime
  runCommand(
    `TESTING WITH BUN RUNTIME: ${name}`,
    `bun ${join(sdkOutput, 'src/index.ts')}`,
  );

  // Test with Node runtime
  runCommand(
    `TESTING WITH NODE RUNTIME: ${name}`,
    `${nodeExec} ${join(sdkOutput, 'src/index.ts')}`,
  );

  // Test browser compatibility by type checking with DOM lib
  runCommand(
    `TYPE CHECKING WITH DOM LIB: ${name}`,
    `./node_modules/.bin/tsc -p ${sdkOutput}/tsconfig.json --lib ES2022,DOM,DOM.Iterable --skipLibCheck`,
  );
}

const width = process.stdout.columns || 80;
const divider = '='.repeat(width);
console.log('\n' + chalk.blue(divider));
console.log(chalk.bgGreen.white.bold(` ALL TESTS COMPLETED SUCCESSFULLY `));
