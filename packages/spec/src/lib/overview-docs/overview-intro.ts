import type { NavItem } from '../sidebar.js';
import type { OurOpenAPIObject } from '../types.js';
import {
  getClientIntroText,
  getTextByCount,
  presetDocs,
} from './doc-text-utils.js';

export function generateIntroOverview(
  spec: OurOpenAPIObject,
  availablesdks: string[],
): NavItem {
  const info = spec.info;
  const markdown: string[] = [];

  if (spec.info.title) {
    markdown.push(`# ${spec.info.title || 'API Reference'}\n`);
  }

  if (spec.info.description) {
    markdown.push(`${spec.info.description}\n`);
  }

  if (spec.info.version) {
    markdown.push(`**Version:** ${spec.info.version}\n`);
  }

  if (info.license) {
    let licenseString = `**License:** ${info.license.name}`;
    if (info.license.url) {
      licenseString += ` ([${info.license.url}](${info.license.url}))`;
    }
    markdown.push(`${licenseString}\n`);
  }

  if (spec.servers && spec.servers.length > 0) {
    const serverCount = spec.servers.length;

    markdown.push(
      `## ${getTextByCount(serverCount, presetDocs.server.section)}`,
    );
    markdown.push(getTextByCount(serverCount, presetDocs.server.description));
    markdown.push('');

    for (const server of spec.servers) {
      let serverLine = `- **${server.url}**`;
      if (server.description) {
        serverLine += ` - ${server.description}`;
      }
      markdown.push(serverLine);
    }
    markdown.push('');
  }

  const sdkCount = availablesdks.length;
  markdown.push(`## ${getTextByCount(sdkCount, presetDocs.client.section)}`);
  markdown.push(getClientIntroText(info.title || 'This API', sdkCount));

  for (const link of availablesdks) {
    const sdkName = link.replace('/', '').replace('-sdk', '').toUpperCase();
    markdown.push(`- [${sdkName} SDK](${link})`);
  }

  // Add "Need Help?" section if support information is available
  const hasSupportInfo =
    info.contact?.email ||
    info.contact?.url ||
    (spec.externalDocs?.url &&
      spec.externalDocs?.description?.toLowerCase().includes('support'));

  if (hasSupportInfo) {
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

    if (
      spec.externalDocs?.url &&
      spec.externalDocs?.description?.toLowerCase().includes('support')
    ) {
      markdown.push(
        `For additional support, visit our [${spec.externalDocs.description}](${spec.externalDocs.url}).`,
      );
    }
  }

  return {
    id: 'generated-introduction',
    title: 'Introduction',
    url: '/introduction',
    description: 'API overview and getting started guide',
    content: markdown.join('\n\n'),
  };
}
