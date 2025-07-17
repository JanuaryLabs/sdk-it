import { type OurOpenAPIObject, toSidebar } from '@sdk-it/spec';

function toTOC(spec: OurOpenAPIObject) {
  const tocLines: string[] = [];
  const sidebar = toSidebar(spec);
  const contents: string[] = [];

  for (const category of sidebar) {
    if (category.category) {
      tocLines.push(`### ${category.category}`);
      tocLines.push('');
    }

    for (const item of category.items) {
      if (item.id !== 'generated-introduction') {
        contents.push(item.content || '');
      }

      if (item.items && item.items.length > 0) {
        // This is a tag/group with operations
        tocLines.push(`- **${item.title}**`);

        // Add each operation in this tag
        for (const subItem of item.items) {
          // Create anchor that matches the markdown header format
          const anchor = `#${subItem.title
            .toLowerCase()
            .replace(/[^\w\s-]/g, '')
            .replace(/\s+/g, '-')}`;
          tocLines.push(`  - [${subItem.title}](${anchor})`);
        }
      } else {
        // This might be a standalone item
        tocLines.push(`- **${item.title}**`);
      }
    }
    tocLines.push('');
  }

  if (spec.components?.schemas) {
    tocLines.push('- [Schemas](#schemas)');
    tocLines.push('');
  }

  return { tocLines, contents };
}

export function toReadme(spec: OurOpenAPIObject) {
  const toc = toTOC(spec);
  const markdown: string[] = [];

  const generatedIntro = spec['x-docs']
    .flatMap((it) => it.items)
    .find((doc) => doc.id === 'generated-introduction');

  if (generatedIntro && generatedIntro.content) {
    markdown.push(generatedIntro.content);
  }

  // markdown.push('---');
  // markdown.push('## Table of Contents');
  // markdown.push(...toc.tocLines);
  // markdown.push('---');

  markdown.push(toc.contents.join('\n\n'));

  return markdown.join('\n\n');
}
