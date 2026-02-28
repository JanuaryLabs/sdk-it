import chalk from 'chalk';
import { execSync } from 'child_process';
import { join } from 'path';

interface Failure {
  spec: string;
  step: string;
}

const failures: Failure[] = [];

function runCommand(
  spec: string,
  title: string,
  command: string,
  memory?: number,
) {
  const width = process.stdout.columns || 80;
  const divider = '='.repeat(width);

  console.log('\n' + chalk.blue(divider));
  console.log(chalk.bgBlue.white.bold(` ${title} `));
  console.log(chalk.blue(divider) + '\n');

  const flags: string[] = [];
  if (memory) {
    flags.push(`--max-old-space-size=${memory}`);
  }

  console.log(
    chalk.dim(`$ ${command}`),
    `with`,
    chalk.dim(`NODE_OPTIONS: ${flags.join(' ')}`),
  );

  try {
    execSync(command, {
      encoding: 'utf-8',
      stdio: 'inherit',
      env: {
        ...process.env,
        NODE_OPTIONS: flags.join(' '),
        NODE_NO_WARNINGS: '1',
      },
    });
    console.log(
      '\n' + chalk.green(`✓ ${title} completed successfully`) + '\n',
    );
  } catch {
    console.log('\n' + chalk.red(`✗ ${title} failed`) + '\n');
    failures.push({ spec, step: title });
  }
}

const specs = [
  // {
  //   spec: 'https://api.infobip.com/platform/1/openapi/whatsapp',
  //   name: 'infobip',
  //   flags: [],
  // },
  {
    spec: 'https://raw.githubusercontent.com/MaximilianKoestler/hcloud-openapi/refs/heads/main/openapi/hcloud.json',
    name: 'hetzner',
    flags: [],
  },
  {
    spec: 'https://raw.githubusercontent.com/discord/discord-api-spec/refs/heads/main/specs/openapi.json',
    name: 'discord',
    flags: [],
  },
  {
    name: 'AppStoreConnect',
    spec: 'https://raw.githubusercontent.com/EvanBacon/App-Store-Connect-OpenAPI-Spec/refs/heads/main/specs/latest.json',
    flags: [],
  },
  {
    spec: 'https://machines-api-spec.fly.dev/spec/openapi3.json',
    name: 'FlyMachines',
    flags: [],
  },
  {
    name: 'Box',
    spec: 'https://raw.githubusercontent.com/box/box-openapi/refs/heads/main/openapi.json',
    flags: [],
  },
  {
    name: 'Turso',
    spec: 'https://raw.githubusercontent.com/tursodatabase/turso-docs/refs/heads/main/api-reference/openapi.json',
    flags: [],
  },
  {
    name: 'openstatus',
    spec: 'https://api.openstatus.dev/v1/openapi',
    flags: [],
  },
  {
    name: 'Serverize',
    spec: 'https://raw.githubusercontent.com/JanuaryLabs/serverize/refs/heads/main/openapi.json',
    flags: [],
  },
  {
    name: 'UploadThings',
    spec: 'https://api.uploadthing.com/openapi-spec.json',
    flags: [],
  },
  {
    name: 'spotify',
    spec: 'https://developer.spotify.com/reference/web-api/open-api-schema.yaml',
    flags: [],
  },
  {
    spec: 'https://raw.githubusercontent.com/figma/rest-api-spec/refs/heads/main/openapi/openapi.yaml',
    name: 'figma',
    flags: [],
  },
];

const filterName = process.argv[2];
const filtered = filterName
  ? specs.filter((s) => s.name.toLowerCase() === filterName.toLowerCase())
  : specs;

if (filterName && filtered.length === 0) {
  console.log(chalk.red(`No spec found matching "${filterName}"`));
  console.log(
    chalk.dim(`Available: ${specs.map((s) => s.name).join(', ')}`),
  );
  process.exit(1);
}

if (filterName) {
  console.log(chalk.cyan(`Running only: ${filtered.map((s) => s.name).join(', ')}\n`));
}

for (const { spec, name, flags } of filtered) {
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

  runCommand(
    name,
    `GENERATING SDK: ${name}`,
    `node ${cliPath} typescript ${sdkFlags.join(' ')}`,
  );

  runCommand(name, `TYPE CHECKING: ${name}`, tsc, 8096);

  runCommand(
    name,
    `TESTING WITH BUN RUNTIME: ${name}`,
    `bun ${join(sdkOutput, 'src', 'index.ts')}`,
  );

  runCommand(
    name,
    `TESTING WITH NODE RUNTIME: ${name}`,
    `node ${join(sdkOutput, 'src', 'index.ts')}`,
  );

  runCommand(
    name,
    `TYPE CHECKING WITH DOM LIB: ${name}`,
    `${tsc} --lib ES2024,DOM,DOM.Iterable,DOM.AsyncIterable --skipLibCheck`,
    8096,
  );
}

const width = process.stdout.columns || 80;
const divider = '='.repeat(width);

if (failures.length > 0) {
  console.log('\n' + chalk.red(divider));
  console.log(chalk.bgRed.white.bold(` ${failures.length} FAILURE(S) `));
  console.log(chalk.red(divider));
  for (const { spec, step } of failures) {
    console.log(chalk.red(`  ✗ [${spec}] ${step}`));
  }
  console.log();
  process.exit(1);
} else {
  console.log('\n' + chalk.blue(divider));
  console.log(chalk.bgGreen.white.bold(` ALL TESTS COMPLETED SUCCESSFULLY `));
}
