import { isEmpty } from '@sdk-it/core';
import { type OurOpenAPIObject, forEachOperation } from '@sdk-it/spec';

import type { Generator } from './generator.ts';
import { PropEmitter } from './prop.emitter.ts';

export function toReadme(spec: OurOpenAPIObject, generators: Generator) {
  // table of content is the navigation headers in apiref
  const markdown: string[] = [];
  const propEmitter = new PropEmitter(spec);

  markdown.push('# API Reference');
  markdown.push('');
  markdown.push(
    'This document provides an overview of the API endpoints available in this service. Each endpoint includes a brief description, example usage, and details about request and response formats.',
  );
  markdown.push('');
  markdown.push('```\n' + generators.client() + '\n```');

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

  return markdown.join('\n\n');
}
