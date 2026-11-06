import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { findPackageJSON } from 'node:module';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

import cli from '@sdk-it/cli/package.json' with { type: 'json' };

test('every @sdk-it package the CLI depends on ships the declarations its exports name', () => {
  const packages = Object.keys(cli.dependencies).filter((name) =>
    name.startsWith('@sdk-it/'),
  );

  const missing = packages.flatMap((name) => {
    const manifestPath = findPackageJSON(name, import.meta.url);
    if (manifestPath === undefined) return [`${name}: no package.json`];
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const types = join(dirname(manifestPath), manifest.exports['.'].types);
    return existsSync(types) ? [] : [`${name}: ${types}`];
  });

  assert.ok(packages.length > 0);
  assert.deepEqual(missing, []);
});
