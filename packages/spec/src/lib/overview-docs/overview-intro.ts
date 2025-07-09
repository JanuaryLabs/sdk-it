import { forEachOperation } from '../for-each-operation.js';
import type { NavItem } from '../sidebar.js';
import type { OurOpenAPIObject } from '../types.js';

export function generateIntroOverview(
  spec: OurOpenAPIObject,
  availablesdks = ['typescript'],
): NavItem {
  const info = spec.info;
  const markdown: string[] = [];

  const tags = new Set<string>();
  const methods = new Set<string>();

  forEachOperation(spec, (entry) => {
    tags.add(entry.tag);
    methods.add(entry.method.toUpperCase());
  });

  if (spec.info.title) {
    markdown.push(`# ${spec.info.title || 'API Reference'}\n`);
  }

  if (spec.info.description) {
    markdown.push(`${spec.info.description}\n`);
  }

  if (spec.info.version) {
    markdown.push(`**Version:** ${spec.info.version}\n`);
  }

  if (spec.servers && spec.servers.length > 0) {
    markdown.push(`## API Servers`);
    markdown.push(`The following servers are available for this API:`);
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

  if (info.contact) {
    markdown.push(`## Contact`);
    if (info.contact.name) {
      markdown.push(`**Name:** ${info.contact.name}`);
    }
    if (info.contact.email) {
      markdown.push(`**Email:** ${info.contact.email}`);
    }
    if (info.contact.url) {
      markdown.push(`**URL:** ${info.contact.url}`);
    }
  }

  if (info.license) {
    markdown.push(`## License`);
    if (info.license.name) {
      let licenseString = `**License:** ${info.license.name}`;
      if (info.license.url) {
        licenseString += ` ([${info.license.url}](${info.license.url}))`;
      }
      markdown.push(licenseString);
    }
  }

  markdown.push(`## Official API Clients`);
  markdown.push(
    `${info.title || 'This API'} provides official client SDKs for multiple programming languages. We recommend using these clients to interact with all stable endpoints. You can find them here:`,
  );

  for (const link of availablesdks) {
    const sdkName = link.replace('/', '').replace('-sdk', '').toUpperCase();
    markdown.push(`- [${sdkName} SDK](${link})`);
  }

  return {
    id: 'generated-introduction',
    title: 'Introduction',
    url: '/introduction',
    description: 'API overview and getting started guide',
    content: markdown.join('\n\n'),
  };
}
