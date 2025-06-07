import { writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

import { augmentSpec } from '@sdk-it/spec';

// eslint-disable-next-line @nx/enforce-module-boundaries
import { DartSerializer } from './packages/dart/src/lib/dart-emitter.ts';

const spec = augmentSpec(
  { spec: JSON.parse(await readFile('ai.json', 'utf-8')) },
  true,
);
const serializer = new DartSerializer(spec, async (name, content) => {
  console.log(`Emitting ${name}...`);
  writeFileSync(`outputs/${name}.dart`, content, 'utf-8');
});

spec.components ??= {};
spec.components.schemas ??= {};
const { content, ...result } = serializer.handle(
  'Page',
  spec.components.schemas.Page,
);

console.log(result);
writeFileSync('outputs/test.dart', content, 'utf-8');
