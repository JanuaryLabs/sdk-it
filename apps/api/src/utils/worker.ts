import { execa } from 'execa';
import { join } from 'node:path';

// start: do not use
const imageName = 'apiref';
const target = 'extract';
const output = 'type=local,dest=./.docker';
// end: do not use

const file = join(process.cwd(), 'packages/apiref/Dockerfile');
const context = '.';
const spec =
  'https://raw.githubusercontent.com/openai/openai-openapi/refs/heads/master/openapi.yaml';

// buildArgs map
const buildArgs = {
  SPEC: spec,
  HETZNER_S3_ENDPOINT: 'fsn1.your-objectstorage.com',
  HETZNER_ACCESS_KEY: 'H3ND25VTX3ZWXFSTJVYH',
  HETZNER_SECRET_KEY: 'aNqWDOj2cF6YVhnWMC2WBNPg8Ih0KrjsolEzTFQT',
  HETZNER_BUCKET: 'apiref',
  BASE: 'local',
};

// turn that into [ '--build-arg','SPEC=…','--build-arg','HETZNER_S3_ENDPOINT=…', … ]
const args = [
  'build',
  '--rm',
  '--pull',
  ...Object.entries(buildArgs).flatMap(([k, v]) => [
    '--build-arg',
    `${k}=${v}`,
  ]),
  '--file',
  file,
  context,
];

console.log(`docker ${args.join(' ')}`);

await execa('docker', args, { stdio: 'inherit' });
