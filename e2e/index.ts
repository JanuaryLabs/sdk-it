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
    spec: 'https://machines-api-spec.fly.dev/spec/openapi3.json',
    name: 'FlyMachines',
    flags: [],
  },
  {
    spec: 'https://raw.githubusercontent.com/MaximilianKoestler/hcloud-openapi/refs/heads/main/openapi/hcloud.json',
    name: 'hetzner',
    flags: ['--output-type=default', '--error-as-value=true'],
  },
  {
    spec: 'https://raw.githubusercontent.com/MaximilianKoestler/hcloud-openapi/refs/heads/main/openapi/hcloud.json',
    name: 'hetzner',
    flags: ['--output-type=status', '--error-as-value=true'],
  },
  {
    spec: 'https://raw.githubusercontent.com/discord/discord-api-spec/refs/heads/main/specs/openapi.json',
    name: 'discord',
    flags: ['--error-as-value=true', '--output-type=status'],
  },
  {
    spec: 'https://raw.githubusercontent.com/discord/discord-api-spec/refs/heads/main/specs/openapi.json',
    name: 'discord',
    flags: ['--error-as-value=false', '--output-type=status'],
  },
  {
    spec: 'https://app.stainless.com/api/spec/documented/openai/openapi.documented.yml',
    name: 'openai',
    flags: ['--output-type=status', '--error-as-value=true'],
  },
  {
    name: 'AppStoreConnect',
    spec: 'https://raw.githubusercontent.com/EvanBacon/App-Store-Connect-OpenAPI-Spec/refs/heads/main/specs/latest.json',
    flags: [],
  },
  {
    name: 'Box',
    spec: 'https://raw.githubusercontent.com/box/box-openapi/refs/heads/main/openapi.json',
    flags: [],
  },
  {
    spec: 'https://app.stainless.com/api/spec/documented/openai/openapi.documented.yml',
    name: 'openai',
    flags: ['--output-type=status', '--error-as-value=false'],
  },
  {
    spec: 'https://app.stainless.com/api/spec/documented/openai/openapi.documented.yml',
    name: 'openai',
    flags: ['--output-type=default', '--error-as-value=true'],
  },
  {
    spec: 'https://app.stainless.com/api/spec/documented/openai/openapi.documented.yml',
    name: 'openai',
    flags: ['--output-type=default', '--error-as-value=false'],
  },
  {
    name: 'Turso',
    spec: 'https://raw.githubusercontent.com/tursodatabase/turso-docs/refs/heads/main/api-reference/openapi.json',
    flags: [],
  },
  {
    name: 'oto',
    spec: join(process.cwd(), '.specs', 'oto.json'),
    flags: ['--readme=false', '--error-as-value=true'],
  },
  {
    name: 'openstatus',
    spec: 'https://api.openstatus.dev/v1/openapi',
    flags: ['--readme=false', '--error-as-value=true'],
  },
  {
    name: 'Serverize',
    spec: 'https://raw.githubusercontent.com/JanuaryLabs/serverize/refs/heads/main/openapi.json',
    flags: [],
  },
  {
    name: 'Nowa',
    spec: 'https://nowa-server-dev-412327058882.europe-west1.run.app/swagger/v1/swagger.json',
    flags: ['--output-type=default'],
  },
  {
    name: 'UploadThings',
    spec: 'https://api.uploadthing.com/openapi-spec.json',
  },
  {
    name: 'OpenAPIWithRecursiveSchemas',
    spec: join(process.cwd(), '.specs', 'problem.json'),
  },
  {
    name: 'spotify',
    spec: 'https://developer.spotify.com/reference/web-api/open-api-schema.yaml',
    flags: [],
  },
  {
    spec: 'https://raw.githubusercontent.com/figma/rest-api-spec/refs/heads/main/openapi/openapi.yaml',
    name: 'figma',
    flags: ['--output-type=status'],
  },
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
    '--no-default-formatter',
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
