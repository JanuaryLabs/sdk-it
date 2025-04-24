import chalk from 'chalk';
import { execSync } from 'child_process';
import { join } from 'path';

function runCommand(title: string, command: string, memory?: number) {
  const width = process.stdout.columns || 80;
  const divider = '='.repeat(width);

  // Print header
  console.log('\n' + chalk.blue(divider));
  console.log(chalk.bgBlue.white.bold(` ${title} `));
  console.log(chalk.blue(divider) + '\n');

  // Run the command and let errors propagate naturally
  const flags: string[] = [];
  if (memory) {
    flags.push(`--max-old-space-size=${memory}`);
  }
  flags.push('--experimental-strip-types');

  console.log(
    chalk.dim(`$ ${command}`),
    `with`,
    chalk.dim(`NODE_OPTIONS: ${flags.join(' ')}`),
  );

  execSync(command, {
    encoding: 'utf-8',
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_OPTIONS: flags.join(' '),
      NODE_NO_WARNINGS: '1',
    },
  });

  // Show success message if execution completes
  console.log('\n' + chalk.green(`✓ ${title} completed successfully`) + '\n');
}

const specs = [
  {
    name: 'openstatus',
    spec: 'https://api.openstatus.dev/v1/openapi',
    flags: ['--readme=true'],
  },
  // {
  //   name: 'UploadThings',
  //   spec: 'https://api.uploadthing.com/openapi-spec.json',
  // },
  // {
  //   name: 'Nowa',
  //   spec: 'https://nowa-server-dev-412327058882.europe-west1.run.app/swagger/v1/swagger.json',
  // },
  // {
  //   name: 'Problem',
  //   spec: join(process.cwd(), '.yamls', 'problem.json'),
  //   flags: ['--no-install'],
  // },
  // {
  //   spec: 'https://raw.githubusercontent.com/openai/openai-openapi/refs/heads/master/openapi.yaml',
  //   name: 'openai',
  //   flags: ['--error-as-value=true', '--output-type=status'],
  // },
  // {
  //   spec: 'https://raw.githubusercontent.com/figma/rest-api-spec/refs/heads/main/openapi/openapi.yaml',
  //   name: 'figma',
  //   flags: ['--error-as-value=false', '--output-type=status'],
  // },
  // {
  //   spec: 'https://docs.hetzner.cloud/spec.json',
  //   name: 'hetzner',
  //   flags: ['--output-type=default'],
  // },
  // {
  //   spec: 'https://raw.githubusercontent.com/discord/discord-api-spec/refs/heads/main/specs/openapi.json',
  //   name: 'discord',
  //   flags: ['--error-as-value=true'],
  // },
];

for (const { spec, name, flags } of specs) {
  console.log('\n' + chalk.magenta('='.repeat(80)));
  console.log(chalk.magenta.bold(`RUNNING TEST SUITE FOR: ${spec}`));
  console.log(chalk.magenta('='.repeat(80)) + '\n');

  const cliPath = join(process.cwd(), 'packages', 'cli', 'src', 'index.ts');

  const sdkOutput = `./.client-${name}`;
  const sdkFlags = [
    `-s ${spec}`,
    `-o ${sdkOutput}`,
    `--name ${name}`,
    '--mode full',
    '--no-install',
    ...(flags ?? []),
  ];
  // invoke TS compiler script via Node for cross‑platform compatibility
  const tsconfigPath = join(sdkOutput, 'tsconfig.json');
  const tscScript = join('node_modules', 'typescript', 'bin', 'tsc');
  const tsc = `node "${tscScript}" -p "${tsconfigPath}"`;

  // Generate SDK
  runCommand(
    `GENERATING SDK: ${name}`,
    `node ${cliPath} typescript ${sdkFlags.join(' ')}`,
  );

  // Run type checking with Node environment
  runCommand(`TYPE CHECKING: ${name}`, tsc, 8096);

  // Test with Bun runtime
  runCommand(
    `TESTING WITH BUN RUNTIME: ${name}`,
    `bun ${join(sdkOutput, 'src', 'index.ts')}`,
  );

  // Test with Node runtime
  runCommand(
    `TESTING WITH NODE RUNTIME: ${name}`,
    `node ${join(sdkOutput, 'src', 'index.ts')}`,
  );

  // Test browser compatibility by type checking with DOM lib
  runCommand(
    `TYPE CHECKING WITH DOM LIB: ${name}`,
    `${tsc} --lib ES2022,DOM,DOM.Iterable --skipLibCheck`,
    8096,
  );
}

const width = process.stdout.columns || 80;
const divider = '='.repeat(width);
console.log('\n' + chalk.blue(divider));
console.log(chalk.bgGreen.white.bold(` ALL TESTS COMPLETED SUCCESSFULLY `));
