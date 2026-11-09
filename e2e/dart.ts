import { execSync } from 'child_process';
import { rmSync } from 'fs';
import { writeFile } from 'fs/promises';
import { userInfo } from 'node:os';
import { styleText } from 'node:util';
import { join, resolve } from 'path';

const localDart = (() => {
  try {
    execSync('dart --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

// As root, the container leaves root-owned files in the bind mount on Linux,
// and the next run's rmSync cannot remove them. An unknown uid has no writable
// home for pub and the analyzer, so HOME is set too. uid is -1 on Windows, where
// a bind mount has no owner to keep.
const { uid, gid } = userInfo();
const containerUser = uid === -1 ? '' : `--user ${uid}:${gid} -e HOME=/tmp`;

/** `command` (a Dart SDK command) run in `directory`: with the local SDK, or in the dart:stable image when none is installed. */
function dart(directory: string, command: string) {
  return localDart
    ? `sh -c "cd ${directory} && ${command}"`
    : `docker run --rm ${containerUser} -v ${directory}:/app -w /app dart:stable sh -c "${command}"`;
}

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
  console.log('\n' + styleText('blue', divider));
  console.log(styleText(['bgBlue', 'white', 'bold'], ` ${title} `));
  console.log(styleText('blue', divider) + '\n');

  // Run the command and let errors propagate naturally
  const flags: string[] = [];
  if (memory) {
    flags.push(`--max-old-space-size=${memory}`);
  }

  console.log(
    styleText('dim', `$ ${command}`),
    `with`,
    styleText('dim', `NODE_OPTIONS: ${flags.join(' ')}`),
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
  console.log(
    '\n' + styleText('green', `✓ ${title} completed successfully`) + '\n',
  );
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
    spec: 'https://raw.githubusercontent.com/openai/openai-openapi/refs/heads/main/openapi.yaml',
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
  console.log('\n' + styleText('magenta', '='.repeat(80)));
  console.log(
    styleText(['magenta', 'bold'], `RUNNING TEST SUITE FOR: ${spec}`),
  );
  console.log(styleText('magenta', '='.repeat(80)) + '\n');

  const cliPath = join(process.cwd(), 'packages', 'cli', 'src', 'bin.ts');

  const sdkOutput = resolve(`./.client-dart-${name}`);
  rmSync(sdkOutput, { recursive: true, force: true });
  const sdkFlags = [
    `-s ${spec}`,
    `-o ${sdkOutput}`,
    `--name ${name}`,
    // The CLI splits the formatter on spaces, so it gets a plain command.
    `--formatter "${localDart ? `dart format ${sdkOutput}/lib` : `docker run --rm ${containerUser} -v ${sdkOutput}:/app -w /app dart:stable dart format lib`}"`,
    ...(flags ?? []),
  ];

  // Generate SDK
  runCommand(
    `GENERATING SDK: ${name}`,
    `node ${cliPath} dart ${sdkFlags.join(' ')}`,
  );
  // main.dart imports the package, so running it compiles what it reaches.
  await writeFile(
    join(sdkOutput, 'main.dart'),
    `import './lib/package.dart';\n\nvoid main() {\n  print('Hello, ${name}!');\n}\n`,
  );
  // One SDK run: pub get resolves packages into this run's pub cache.
  // analyze checks every file, not only what main.dart reaches; its
  // warnings stay non-fatal until generated files stop importing unused
  // libraries.
  runCommand(
    `ANALYZING AND RUNNING: ${name}`,
    dart(
      sdkOutput,
      'dart pub get && dart analyze --no-fatal-warnings lib && dart run main.dart',
    ),
  );
}

const width = process.stdout.columns || 80;
const divider = '='.repeat(width);
console.log('\n' + styleText('blue', divider));
console.log(
  styleText(['bgGreen', 'white', 'bold'], ` ALL TESTS COMPLETED SUCCESSFULLY `),
);
