import {
  GENERATED_DOC_IDS,
  extractOverviewDocs,
} from '../overview-docs/overview-docs.js';
import {
  RESERVED_DOC_IDS,
  type ResolvedDoc,
  type SdkDoc,
  isAuthoredDoc,
  isSdkDoc,
  slugify,
} from '../overview-docs/types.js';
import type { ProcessingContext, ProcessingPlugin } from '../processing.js';

export function extractOverviewDocsPlugin(): ProcessingPlugin {
  return {
    name: 'extract-overview-docs',
    process(context) {
      const sdks = collectSdks(context);
      const entries = collectDocs(context);
      context.spec['x-sdks'] = sdks;
      context.spec['x-docs'] = extractOverviewDocs(context.spec, {
        entries,
        sdks,
      });
    },
  };
}

function collectSdks({ options, report }: ProcessingContext): SdkDoc[] {
  const raw = options.docs.sdks;
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    report({
      severity: 'warning',
      code: 'invalid-x-sdks',
      message: 'x-sdks must be an array of { language, package, url? }.',
      path: '/x-sdks',
    });
    return [];
  }
  return raw.filter((entry: unknown, index): entry is SdkDoc => {
    if (isSdkDoc(entry)) return true;
    report({
      severity: 'warning',
      code: 'invalid-x-sdks',
      message:
        'x-sdks entries need a language of typescript, python, or dart and a package name.',
      path: `/x-sdks/${index}`,
    });
    return false;
  });
}

function collectDocs({ options, report }: ProcessingContext): ResolvedDoc[] {
  const raw = options.docs.entries;
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    report({
      severity: 'warning',
      code: 'invalid-x-docs',
      message:
        'x-docs must be an array of { id?, title, description?, content? }.',
      path: '/x-docs',
    });
    return [];
  }

  const docs: ResolvedDoc[] = [];
  const seen = new Set<string>();
  raw.forEach((entry: unknown, index) => {
    const path = `/x-docs/${index}`;
    const invalid = (message: string) =>
      report({ severity: 'warning', code: 'invalid-x-docs', message, path });

    if (!isAuthoredDoc(entry)) {
      invalid(
        'x-docs entries need a title; id, description, and content must be strings.',
      );
      return;
    }
    const id = slugify(entry.id ?? entry.title);
    if (!id) {
      invalid(`Cannot derive a url-safe id from "${entry.id ?? entry.title}".`);
      return;
    }
    if (RESERVED_DOC_IDS.has(id)) {
      report({
        severity: 'warning',
        code: 'reserved-x-docs-id',
        message: `"${id}" is reserved by the API reference and cannot be used as a doc id.`,
        path,
      });
      return;
    }
    if (seen.has(id)) {
      report({
        severity: 'warning',
        code: 'duplicate-x-docs-id',
        message: `Doc id "${id}" is used more than once; later entries are ignored.`,
        path,
      });
      return;
    }
    if (!GENERATED_DOC_IDS.has(id) && !entry.content && !entry.description) {
      invalid(`Custom doc "${id}" needs content or a description to render.`);
      return;
    }
    seen.add(id);
    docs.push({ ...entry, id });
  });
  return docs;
}
