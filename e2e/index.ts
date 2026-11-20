import { execSync } from 'child_process';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { styleText } from 'node:util';
import { join } from 'path';

import { clientName } from '@sdk-it/typescript';

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

  console.log('\n' + styleText('blue', divider));
  console.log(styleText(['bgBlue', 'white', 'bold'], ` ${title} `));
  console.log(styleText('blue', divider) + '\n');

  const flags: string[] = [];
  if (memory) {
    flags.push(`--max-old-space-size=${memory}`);
  }

  console.log(
    styleText('dim', `$ ${command}`),
    `with`,
    styleText('dim', `NODE_OPTIONS: ${flags.join(' ')}`),
  );

  const started = performance.now();
  const elapsed = () => `${((performance.now() - started) / 1000).toFixed(1)}s`;
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
      '\n' +
        styleText(
          'green',
          `✓ ${title} completed successfully in ${elapsed()}`,
        ) +
        '\n',
    );
    return true;
  } catch {
    console.log(
      '\n' + styleText('red', `✗ ${title} failed after ${elapsed()}`) + '\n',
    );
    failures.push({ spec, step: title });
    return false;
  }
}

// invoke TS compiler script via Node for cross‑platform compatibility
const tscScript = join('node_modules', '@typescript', 'native', 'bin', 'tsc');

function importSpecInEveryHost(name: string, spec: string) {
  const dir = join(process.cwd(), '.test-workspaces', `e2e-import-${name}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  const extension = /\.ya?ml$/.test(new URL(spec).pathname)
    ? '.openapi.yaml'
    : '.openapi';
  const document = `${name}${extension}`;
  const downloaded = runCommand(
    name,
    `DOWNLOADING SPEC: ${name}`,
    `curl -fsSL -o "${join(dir, document)}" "${spec}"`,
  );
  if (!downloaded) {
    return;
  }

  const client = clientName(name);
  writeFileSync(
    join(dir, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        module: 'nodenext',
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        types: [],
      },
      contentMappers: [
        {
          package: '@sdk-it/content-mapper',
          extensions: ['.openapi', '.openapi.yaml'],
        },
      ],
      include: ['main.ts'],
    }),
  );
  writeFileSync(
    join(dir, 'main.ts'),
    `import { create${client}, type ${client}Endpoints } from './${document}';

export type Keys = keyof ${client}Endpoints;

if (typeof create${client} !== 'function') {
  throw new TypeError('create${client} is not a function');
}
`,
  );
  writeFileSync(
    join(dir, 'build.mjs'),
    `import sdkIt from '@sdk-it/vite';
import { build } from 'vite';

await build({
  configFile: false,
  root: import.meta.dirname,
  logLevel: 'warn',
  plugins: [sdkIt.imports()],
  build: { ssr: 'main.ts', outDir: 'dist', emptyOutDir: true },
});
await import(new URL('dist/main.js', import.meta.url).href);
`,
  );

  runCommand(
    name,
    `IMPORT TYPES (tsc + content mapper): ${name}`,
    `node "${tscScript}" -p "${dir}" --runExternalCode --pretty false`,
    8096,
  );
  runCommand(
    name,
    `IMPORT NODE (--import register): ${name}`,
    `node --import @sdk-it/content-mapper/register "${join(dir, 'main.ts')}"`,
  );
  runCommand(
    name,
    `IMPORT VITE (sdkIt.imports() build): ${name}`,
    `node "${join(dir, 'build.mjs')}"`,
  );
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
    spec: 'https://docs.machines.dev/openapi.json',
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
    spec: 'https://api.openstatus.dev/openapi.yaml',
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
  console.log(styleText('red', `No spec found matching "${filterName}"`));
  console.log(
    styleText('dim', `Available: ${specs.map((s) => s.name).join(', ')}`),
  );
  process.exit(1);
}

if (filterName) {
  console.log(
    styleText(
      'cyan',
      `Running only: ${filtered.map((s) => s.name).join(', ')}\n`,
    ),
  );
}

for (const { spec, name, flags } of filtered) {
  console.log('\n' + styleText('magenta', '='.repeat(80)));
  console.log(
    styleText(['magenta', 'bold'], `RUNNING TEST SUITE FOR: ${spec}`),
  );
  console.log(styleText('magenta', '='.repeat(80)) + '\n');

  const cliPath = join(process.cwd(), 'packages', 'cli', 'src', 'bin.ts');

  const sdkOutput = `./.client-${name}`;
  rmSync(sdkOutput, { recursive: true, force: true });
  const sdkFlags = [
    `-s ${spec}`,
    `-o ${sdkOutput}`,
    `--name ${name}`,
    `--package-name @e2e/${name.toLowerCase()}`,
    '--mode full',
    '--no-install',
    '--no-default-formatter',
    ...(flags ?? []),
  ];
  const tsconfigPath = join(sdkOutput, 'tsconfig.json');
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
    `${tsc} --lib ES2024,DOM --skipLibCheck`,
    8096,
  );

  importSpecInEveryHost(name, spec);
}

const width = process.stdout.columns || 80;
const divider = '='.repeat(width);

if (failures.length > 0) {
  console.log('\n' + styleText('red', divider));
  console.log(
    styleText(['bgRed', 'white', 'bold'], ` ${failures.length} FAILURE(S) `),
  );
  console.log(styleText('red', divider));
  for (const { spec, step } of failures) {
    console.log(styleText('red', `  ✗ [${spec}] ${step}`));
  }
  console.log();
  process.exit(1);
} else {
  console.log('\n' + styleText('blue', divider));
  console.log(
    styleText(
      ['bgGreen', 'white', 'bold'],
      ` ALL TESTS COMPLETED SUCCESSFULLY `,
    ),
  );
}
