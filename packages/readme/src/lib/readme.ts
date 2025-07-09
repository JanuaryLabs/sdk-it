import { isEmpty } from '@sdk-it/core';
import {
  type OurOpenAPIObject,
  forEachOperation,
  toSidebar,
} from '@sdk-it/spec';

import type { Generator } from './generator.ts';
import { PropEmitter } from './prop.emitter.ts';

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
      if (item.id === 'generated-introduction') continue;

      contents.push(item.content || '');
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

export function toReadme(spec: OurOpenAPIObject, generators: Generator) {
  const propEmitter = new PropEmitter(spec);
  const toc = toTOC(spec);
  const markdown: string[] = [];

  const generatedIntro = spec['x-docs']
    .flatMap((it) => it.items)
    .find((doc) => doc.id === 'generated-introduction');

  if (generatedIntro && generatedIntro.content) {
    markdown.push(generatedIntro.content);
  }

  markdown.push('---');
  markdown.push('## Table of Contents');
  markdown.push(...toc.tocLines);
  markdown.push('---');

  markdown.push(
    'This document provides an overview of the API endpoints available in this service. Each endpoint includes a brief description, example usage, and details about request and response formats.',
  );
  markdown.push('');
  markdown.push('');
  markdown.push('```ts\n' + generators.client() + '\n```');
  markdown.push('');

  markdown.push(toc.contents.join('\n\n'));

  forEachOperation(spec, (entry, operation) => {
    const { method, path } = entry;
    markdown.push(
      `#### ${operation['x-fn-name']} | ${`_${method.toUpperCase()} ${path}_`}`,
    );
    markdown.push(operation.summary || '');

    const snippet = generators.snippet(entry, operation);
    markdown.push(`##### Example usage`);
    markdown.push(snippet);

    // Process request body using the refactored emitter
    const requestBodyContent = propEmitter.requestBody(operation.requestBody);
    if (requestBodyContent.length > 1) {
      // Check if more than just the header was added
      markdown.push(requestBodyContent.join('\n\n'));
    }

    markdown.push(`##### Responses`);
    for (const status in operation.responses) {
      const response = operation.responses[status];
      // Wrap each response in its own toggle
      markdown.push(`<details>`);
      markdown.push(
        `<summary><b>${status}</b>  <i>${response.description}</i></summary>`,
      );
      if (!isEmpty(response.content)) {
        for (const [contentType, mediaType] of Object.entries(
          response.content,
        )) {
          markdown.push(`\n**Content Type:** \`${contentType}\``);
          if (mediaType.schema) {
            const schemaDocs = propEmitter.handle(mediaType.schema);
            // hide emitter output under the toggle
            markdown.push(...schemaDocs.map((l) => `\n${l}`));
          }
        }
      }
      markdown.push(`</details>`);
    }
  }); // Add schemas section at the bottom
  if (spec.components?.schemas) {
    markdown.push('## Schemas');
    markdown.push('');

    for (const [schemaName, schema] of Object.entries(
      spec.components.schemas,
    )) {
      // Include all schemas except ValidationError which is internal
      if (schemaName === 'ValidationError') {
        continue;
      }

      markdown.push(`<details>`);
      markdown.push(
        `<summary><h3 id="${schemaName.toLowerCase()}">${schemaName}</h3></summary>`,
      );
      markdown.push('');

      const schemaDocs = propEmitter.handle(schema);
      markdown.push(...schemaDocs.map((line) => line.trim()));

      markdown.push('');
      markdown.push(`</details>`);
      markdown.push('');
    }
  }

  // Generate Table of Contents

  return markdown.join('\n\n');
}
