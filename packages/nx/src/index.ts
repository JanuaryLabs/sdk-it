import { type Tree, createProjectGraphAsync } from '@nx/devkit';
import { join, relative } from 'node:path';

import { DerivedDocument } from '@sdk-it/content-mapper';

/**
 * The `openapi-sync` sync generator: writes each derived OpenAPI document
 * that a project's tsconfig*.json declares (`contentMappers[].options.derived`)
 * when the bytes its backend derives differ from the committed ones. It is
 * the documents' only writer; the readers derive them in memory.
 */
export default async function openapiSync(tree: Tree) {
  const graph = await createProjectGraphAsync();
  const documents = new Map<string, DerivedDocument>();
  for (const { data } of Object.values(graph.nodes)) {
    const tsconfigs = tree
      .children(data.root)
      .filter((name) => /^tsconfig.*\.json$/.test(name))
      .toSorted();
    for (const name of tsconfigs) {
      const tsconfig = join(data.root, name);
      // A tsconfig that never says "derived" declares no derived document, so
      // most projects start no TypeScript process.
      if (!tree.read(tsconfig, 'utf8')?.includes('"derived"')) continue;
      for (const document of await DerivedDocument.declaredBy(
        join(tree.root, tsconfig),
      )) {
        documents.set(document.path, document);
      }
    }
  }

  const stale: string[] = [];
  const failed: string[] = [];
  for (const document of documents.values()) {
    const path = relative(tree.root, document.path);
    const derivation = await document.derive();
    if (derivation.kind === 'failed') {
      failed.push(`${path}: ${derivation.message}`);
    } else if (tree.read(path, 'utf8') !== derivation.text) {
      tree.write(path, derivation.text);
      stale.push(path);
    }
  }
  if (failed.length > 0) {
    throw new Error(
      `A derived OpenAPI document's backend does not analyze:\n${failed.join('\n')}`,
    );
  }
  return stale.length === 0
    ? {}
    : {
        outOfSyncMessage:
          'Some derived OpenAPI documents differ from what their backends produce.',
        outOfSyncDetails: stale,
      };
}
