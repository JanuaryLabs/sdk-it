import chalk from 'chalk';
import { execSync } from 'child_process';
import { dirname, join } from 'path';

const __filename = new URL(import.meta.url).pathname;
const __dirname = dirname(__filename);

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

// Generate SDK
runCommand('GENERATING SDK', `${nodeExec} ${cliPath} ${sdkFlags.join(' ')}`);

// Run type checking with Node environment
runCommand(
  'TYPE CHECKING',
  `./node_modules/.bin/tsc -p ${sdkOutput}/tsconfig.json`,
);

// Test with Bun runtime
runCommand(
  'TESTING WITH BUN RUNTIME',
  `bun ${join(sdkOutput, 'src/index.ts')}`,
);

// Test with Node runtime
runCommand(
  'TESTING WITH NODE RUNTIME',
  `${nodeExec} ${join(sdkOutput, 'src/index.ts')}`,
);

// Test browser compatibility by type checking with DOM lib
runCommand(
  'TYPE CHECKING WITH DOM LIB',
  `./node_modules/.bin/tsc -p ${sdkOutput}/tsconfig.json --lib ES2022,DOM,DOM.Iterable --skipLibCheck`,
);

// If we got here, all commands succeeded
const width = process.stdout.columns || 80;
const divider = '='.repeat(width);
console.log('\n' + chalk.blue(divider));
console.log(chalk.bgGreen.white.bold(` ALL TESTS COMPLETED SUCCESSFULLY `));
console.log(chalk.blue(divider) + '\n');
