import { join } from 'node:path';

import { readJson } from '@sdk-it/core/file-system.js';

export async function guessTypescriptPackageName(
  consideringMultipleGenerator: boolean,
): Promise<string> {
  try {
    const packageJson = await readJson<{ name: string }>(
      join(process.cwd(), 'package.json'),
    );
    if (packageJson.name) {
      const match = packageJson.name.match(/^@([^/]+)/);
      if (match) {
        const scope = match[1];
        return consideringMultipleGenerator
          ? `@${scope}/ts-sdk`
          : `@${scope}/sdk`;
      }
    }
  } catch {
    // If package.json doesn't exist or can't be read, use fallback
  }

  // Fallback if no package.json or no scope found
  return consideringMultipleGenerator ? 'ts-sdk' : 'sdk';
}
