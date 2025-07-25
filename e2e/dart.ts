import chalk from 'chalk';
import { execSync } from 'child_process';
import { writeFile } from 'fs/promises';
import { join } from 'path';

function runCommand(
  title: string,
  command: string,
  options?: {
    memory?: number;
    cwd?: string;
  },
) {
  const memory = options?.memory;
  const cwd = options?.cwd || process.cwd();
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
    cwd,
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
    name: 'AppStoreConnect',
    spec: 'https://raw.githubusercontent.com/EvanBacon/App-Store-Connect-OpenAPI-Spec/refs/heads/main/specs/latest.json',
    flags: [],
  },
  {
    name: 'openstatus',
    spec: 'https://api.openstatus.dev/v1/openapi',
    flags: [],
  },
  {
    name: 'Box',
    spec: 'https://raw.githubusercontent.com/box/box-openapi/refs/heads/main/openapi.json',
    flags: [],
  },
  {
    name: 'openai',
    spec: 'https://app.stainless.com/api/spec/documented/openai/openapi.documented.yml',
    flags: [],
  },
  {
    name: 'oto',
    spec: join(process.cwd(), '.specs', 'oto.json'),
    flags: [],
  },
  {
    name: 'Serverize',
    spec: 'https://raw.githubusercontent.com/JanuaryLabs/serverize/refs/heads/main/openapi.json',
    flags: [],
  },
  {
    name: 'Nowa',
    spec: 'https://nowa-server-dev-412327058882.europe-west1.run.app/swagger/v1/swagger.json',
    flags: [],
  },
  {
    name: 'UploadThings',
    spec: 'https://api.uploadthing.com/openapi-spec.json',
    flags: [],
  },
  {
    name: 'OpenAPIWithRecursiveSchemas',
    spec: join(process.cwd(), '.specs', 'problem.json'),
  },
  {
    spec: 'https://raw.githubusercontent.com/MaximilianKoestler/hcloud-openapi/refs/heads/main/openapi/hcloud.json',
    name: 'hetzner',
    flags: [],
  },
  {
    spec: 'https://raw.githubusercontent.com/figma/rest-api-spec/refs/heads/main/openapi/openapi.yaml',
    name: 'figma',
    flags: [],
  },
  {
    name: 'spotify',
    spec: 'https://developer.spotify.com/reference/web-api/open-api-schema.yaml',
    flags: [],
  },
  {
    name: 'Turso',
    spec: 'https://raw.githubusercontent.com/tursodatabase/turso-docs/refs/heads/main/api-reference/openapi.json',
    flags: [],
  },
  {
    spec: 'https://raw.githubusercontent.com/discord/discord-api-spec/refs/heads/main/specs/openapi.json',
    name: 'discord',
    flags: [],
  },
];

for (const { spec, name, flags } of specs) {
  console.log('\n' + chalk.magenta('='.repeat(80)));
  console.log(chalk.magenta.bold(`RUNNING TEST SUITE FOR: ${spec}`));
  console.log(chalk.magenta('='.repeat(80)) + '\n');

  const cliPath = join(process.cwd(), 'packages', 'cli', 'src', 'index.ts');

  const sdkOutput = `./.client-dart-${name}`;
  const sdkFlags = [
    `-s ${spec}`,
    `-o ${sdkOutput}`,
    `--name ${name}`,
    ...(flags ?? []),
  ];

  // Generate SDK
  runCommand(
    `GENERATING SDK: ${name}`,
    `node ${cliPath} dart ${sdkFlags.join(' ')}`,
  );
  // Pub Get dependencies
  runCommand(`RUNNING Pub Get: ${name}`, `dart pub get`, {
    cwd: sdkOutput,
  });

  // write main.dart with import statement to make sure it compiles
  const mainFilePath = join(sdkOutput, 'main.dart');
  await writeFile(
    mainFilePath,
    `import './lib/package.dart';\n\nvoid main() {\n  print('Hello, ${name}!');\n}\n`,
  );
  // Run dart
  runCommand(`RUNNING Dart: ${name}`, `dart run ${mainFilePath}`);
}

const width = process.stdout.columns || 80;
const divider = '='.repeat(width);
console.log('\n' + chalk.blue(divider));
console.log(chalk.bgGreen.white.bold(` ALL TESTS COMPLETED SUCCESSFULLY `));
