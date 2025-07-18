import type { SidebarData } from '../sidebar.js';
import type { IR } from '../types.js';
import { generateAuthOverview } from './overview-auth.js';
import { generateErrorsOverview } from './overview-errors.js';
import { generateIntroOverview } from './overview-intro.js';

export function extractOverviewDocs(
  spec: IR,
  availableSdks: string[] = ['typescript'],
): SidebarData {
  return [
    {
      id: 'overview',
      category: 'Overview',
      items: [
        generateIntroOverview(spec, availableSdks),
        generateAuthOverview(spec),
        generateErrorsOverview(spec),
      ],
    },
  ];
}
