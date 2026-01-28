import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function getTemplatePath() {
  return join(__dirname, 'http', 'parse-response.txt');
}

describe('parse-response template', () => {
  test('binary responses use response.blob()', async () => {
    const template = await readFile(getTemplatePath(), 'utf-8');
    assert.match(template, /response\.blob\(\)/);
    assert.match(template, /application\/pdf/);
    assert.match(template, /type\.startsWith\(\"text\/\"\)/);
  });
});
