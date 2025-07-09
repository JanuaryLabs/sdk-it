import type { SidebarData } from '../sidebar.js';
import type { OurOpenAPIObject } from '../types.js';
import { generateAuthOverview } from './overview-auth.js';
import { generateErrorsOverview } from './overview-errors.js';
import { generateIntroOverview } from './overview-intro.js';

export function extractOverviewDocs(
  spec: OurOpenAPIObject,
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
