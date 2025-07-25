import { resolve } from 'node:path';

import { exist } from '@sdk-it/core/file-system.js';

const monorepoIndicators = {
  lerna: () => exist(resolve(process.cwd(), 'lerna.json')),
  nx: () => exist(resolve(process.cwd(), 'nx.json')),
  pnpm: () => exist(resolve(process.cwd(), 'pnpm-workspace.yaml')),
  rush: () => exist(resolve(process.cwd(), 'rush.json')),
} as const;

type Monorepo = keyof typeof monorepoIndicators;

export async function detectMonorepo(): Promise<Monorepo | undefined> {
  for (const [indicator, check] of Object.entries(monorepoIndicators)) {
    if (await check()) {
      return indicator as Monorepo;
    }
  }
  return void 0;
}
