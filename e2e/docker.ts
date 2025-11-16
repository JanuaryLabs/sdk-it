import chalk from 'chalk';
import Docker from 'dockerode';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'path';

const docker = new Docker();

interface TestSpec {
  name: string;
  spec: string;
  flags?: string[];
}

function logHeader(title: string) {
  const width = process.stdout.columns || 80;
  const divider = '='.repeat(width);
  console.log('\n' + chalk.blue(divider));
  console.log(chalk.bgBlue.white.bold(` ${title} `));
  console.log(chalk.blue(divider) + '\n');
}

async function runInContainer(
  title: string,
  command: string,
  workDir = '/app',
  mounts: Docker.MountConfig = [],
): Promise<void> {
  logHeader(title);
  console.log(chalk.dim(`$ ${command}`));

  const container = await docker.createContainer({
    Image: 'node:lts-alpine',
    Cmd: ['sh', '-c', command],
    WorkingDir: workDir,
    HostConfig: {
      Mounts: [
        {
          Target: '/app',
          Source: process.cwd(),
          Type: 'bind',
          ReadOnly: false,
        },
        ...mounts,
      ],
      AutoRemove: true,
    },
    AttachStdout: true,
    AttachStderr: true,
  });

  const stream = await container.attach({
    stream: true,
    stdout: true,
    stderr: true,
  });

  // Pipe container output to current process
  stream.pipe(process.stdout);

  await container.start();
  const result = await container.wait();

  if (result.StatusCode !== 0) {
    throw new Error(`Command failed with exit code ${result.StatusCode}`);
  }

  console.log('\n' + chalk.green(`✓ ${title} completed successfully`) + '\n');
}

async function setupContainer(): Promise<void> {
  logHeader('SETTING UP DOCKER ENVIRONMENT');

  // Install dependencies and build SDK-IT CLI
  await runInContainer(
    'Installing dependencies',
    'npm install --frozen-lockfile',
  );

  await runInContainer(
    'Building SDK-IT CLI',
    'npm run build --workspace=packages/cli',
  );
}

async function testSpec(spec: TestSpec): Promise<void> {
  console.log('\n' + chalk.magenta('='.repeat(80)));
  console.log(chalk.magenta.bold(`TESTING IN DOCKER: ${spec.name}`));
  console.log(chalk.magenta('='.repeat(80)) + '\n');

  const outputDir = `./.client-${spec.name}`;
  const hostOutputDir = join(process.cwd(), outputDir);

  // Clean up previous output
  try {
    rmSync(hostOutputDir, { recursive: true, force: true });
  } catch (error) {
    // Ignore if directory doesn't exist
  }

  // Create output directory
  mkdirSync(hostOutputDir, { recursive: true });

  const flags = [
    `-s ${spec.spec}`,
    `-o ${outputDir}`,
    `--name ${spec.name}`,
    '--mode full',
    '--no-install',
    '--no-default-formatter',
    ...(spec.flags ?? []),
  ];

  const cliCommand = `node packages/cli/dist/index.js typescript ${flags.join(' ')}`;

  // Generate SDK in container
  await runInContainer(`Generating SDK: ${spec.name}`, cliCommand);

  // Install TypeScript in container for type checking
  await runInContainer(`Installing TypeScript`, 'npm install -g typescript');

  // Type check generated SDK
  await runInContainer(
    `Type checking: ${spec.name}`,
    `tsc -p ${outputDir}/tsconfig.json`,
    '/app',
  );

  // Test with Node runtime in container
  await runInContainer(
    `Testing with Node runtime: ${spec.name}`,
    `node ${outputDir}/src/index.ts`,
  );

  // Type check with DOM lib for browser compatibility
  await runInContainer(
    `Type checking with DOM lib: ${spec.name}`,
    `tsc -p ${outputDir}/tsconfig.json --lib ES2022,DOM,DOM.Iterable --skipLibCheck`,
  );
}
await setupContainer();

const specs: TestSpec[] = [
  {
    name: 'openstatus',
    spec: 'https://api.openstatus.dev/v1/openapi',
    flags: [],
  },
  {
    name: 'Turso',
    spec: 'https://raw.githubusercontent.com/tursodatabase/turso-docs/refs/heads/main/api-reference/openapi.json',
    flags: [],
  },
  {
    name: 'spotify',
    spec: 'https://developer.spotify.com/reference/web-api/open-api-schema.yaml',
    flags: [],
  },
  {
    name: 'UploadThings',
    spec: 'https://api.uploadthing.com/openapi-spec.json',
    flags: [],
  },
  {
    name: 'openai',
    spec: 'https://raw.githubusercontent.com/openai/openai-openapi/refs/heads/master/openapi.yaml',
    flags: [],
  },
];

for (const spec of specs) {
  await testSpec(spec);
}

const width = process.stdout.columns || 80;
const divider = '='.repeat(width);
console.log('\n' + chalk.blue(divider));
console.log(
  chalk.bgGreen.white.bold(` ALL DOCKER TESTS COMPLETED SUCCESSFULLY `),
);
console.log(chalk.blue(divider) + '\n');
