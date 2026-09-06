import type { NavItem } from '../sidebar.js';
import type { IR } from '../types.js';
import { getTextByCount, presetDocs } from './doc-text-utils.js';
import { generateSdkSection } from './overview-sdks.js';
import type { SdkDoc } from './types.js';

export function generateOverviewPage(spec: IR, sdks: SdkDoc[]): NavItem {
  const info = spec.info;
  const apiTitle = info.title || 'API Reference';
  const markdown: string[] = [`# ${apiTitle}`];

  if (info.description) {
    markdown.push(info.description);
  }

  if (info.version) {
    markdown.push(`**Version:** ${info.version}`);
  }

  if (info.license) {
    const license = info.license.url
      ? `${info.license.name} ([${info.license.url}](${info.license.url}))`
      : info.license.name;
    markdown.push(`**License:** ${license}`);
  }

  if (spec.servers.length > 0) {
    const serverCount = spec.servers.length;
    markdown.push(
      `## ${getTextByCount(serverCount, presetDocs.server.section)}`,
    );
    markdown.push(getTextByCount(serverCount, presetDocs.server.description));
    markdown.push(
      spec.servers
        .map((server) =>
          server.description
            ? `- **${server.url}** - ${server.description}`
            : `- **${server.url}**`,
        )
        .join('\n'),
    );
  }

  markdown.push(...generateSdkSection(apiTitle, sdks));

  const supportDocs =
    spec.externalDocs?.url &&
    spec.externalDocs.description?.toLowerCase().includes('support')
      ? spec.externalDocs
      : undefined;

  if (info.contact?.email || info.contact?.url || supportDocs) {
    markdown.push(`## Need Help?`);

    if (info.contact?.email) {
      markdown.push(
        `For support, reach out to us at [${info.contact.email}](mailto:${info.contact.email}).`,
      );
    }

    if (info.contact?.url) {
      markdown.push(
        `Visit our support page: [${info.contact.url}](${info.contact.url})`,
      );
    }

    if (supportDocs) {
      markdown.push(
        `For additional support, visit our [${supportDocs.description}](${supportDocs.url}).`,
      );
    }
  }

  return {
    id: 'overview',
    url: '/',
    title: 'Overview',
    description: 'API overview and getting started guide',
    content: markdown.join('\n\n'),
  };
}
