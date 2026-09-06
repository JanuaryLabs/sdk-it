import type { NavItem, SidebarData } from '../sidebar.js';
import type { IR } from '../types.js';
import { generateAuthOverview } from './overview-auth.js';
import { generateErrorsOverview } from './overview-errors.js';
import { generateOverviewPage } from './overview-page.js';
import type { ResolvedDoc, SdkDoc } from './types.js';

export interface OverviewDocsInput {
  entries: ResolvedDoc[];
  sdks: SdkDoc[];
}

/** Ids of the pages SDK-IT generates; an authored entry with one of these ids seeds that page. */
export const GENERATED_DOC_IDS: ReadonlySet<string> = new Set([
  'overview',
  'authorization',
  'errors',
]);

export function extractOverviewDocs(
  spec: IR,
  input: OverviewDocsInput,
): SidebarData {
  const generated = [
    generateOverviewPage(spec, input.sdks),
    generateAuthOverview(spec),
    generateErrorsOverview(spec),
  ];
  const seeds = new Map(input.entries.map((entry) => [entry.id, entry]));

  const items = generated.map((page) => {
    const seed = seeds.get(page.id);
    seeds.delete(page.id);
    return seed ? seedPage(page, seed) : page;
  });

  for (const entry of seeds.values()) {
    items.push({
      id: entry.id,
      title: entry.title,
      description: entry.description,
      url: `/${entry.id}`,
      content: entry.content ?? entry.description,
    });
  }

  return [{ id: 'overview', category: 'Overview', items }];
}

function seedPage(page: NavItem, seed: ResolvedDoc): NavItem {
  const body = page.content?.replace(/^#\s[^\n]*\n+/, '') ?? '';
  return {
    ...page,
    title: seed.title,
    description: seed.description ?? page.description,
    content: [`# ${seed.title}`, seed.description, seed.content, body]
      .filter(Boolean)
      .join('\n\n'),
  };
}
