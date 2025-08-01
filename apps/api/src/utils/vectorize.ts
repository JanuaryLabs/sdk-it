import { toReadme } from '@sdk-it/readme';
import type { IR } from '@sdk-it/spec';

import db from './db';
import openai from './openai';

export const VECTOR_STORE_ID = 'vs_6811cd14ce408191b504bef45808aed1';

export async function vectorise(spec: IR) {
  // await openai.vectorStores.files.retrieve(VECTOR_STORE_ID);
  const alreadyVectorized = db.data.some(
    (item) => item.specId === spec.info.title,
  );
  if (alreadyVectorized) {
    console.log('Spec already vectorised');
    return;
  }
  console.log('Vectorising spec:', spec.info.title);
  const content = toReadme(spec);

  const file = await openai.files.create({
    purpose: 'assistants',
    file: new File([JSON.stringify(content)], `${spec.info.title}.txt`, {
      type: 'text/plain',
    }),
  });
  await openai.vectorStores.files.createAndPoll(VECTOR_STORE_ID, {
    file_id: file.id,
    attributes: {
      name: spec.info.title,
    },
  });
  db.data.push({
    specId: spec.info.title,
    openAIFileId: file.id,
  });
  await db.write();
  console.log('Vectorised spec:', spec.info.title);
}
