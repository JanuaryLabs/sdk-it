import { isEmpty } from '@sdk-it/core';
import type { Generator } from '@sdk-it/readme';
import { type OurOpenAPIObject, forEachOperation } from '@sdk-it/spec';

import { PropEmitter } from './prop.emitter.ts';

export function toReadme(spec: OurOpenAPIObject, generator: Generator) {
  const propEmitter = new PropEmitter(spec);
  const markdown: string[] = [];

  // Add TypeScript SDK heading and description
  markdown.push(`# ${spec.info.title} TypeScript SDK`);
  markdown.push('');
  markdown.push(
    'A fully-typed TypeScript SDK with comprehensive IntelliSense support, automatic request/response validation, and modern async/await patterns. Built for seamless integration with TypeScript and JavaScript projects.',
  );
  markdown.push('');

  // Use TypeScript generator for documentation methods
  markdown.push(generator.clientSetupDocs());
  markdown.push('');

  // Add authentication docs if there are security schemes
  const securitySchemes = spec.components?.securitySchemes || {};
  if (Object.keys(securitySchemes).length > 0) {
    markdown.push(generator.authenticationDocs());
    markdown.push('');
  }

  // Add pagination docs if any operations have pagination
  const paginationDocs = generator.paginationDocs();
  if (paginationDocs) {
    markdown.push(paginationDocs);
    markdown.push('');
  }

  // Add error handling docs
  markdown.push(generator.errorHandlingDocs());
  markdown.push('');

  // Add general usage docs
  markdown.push(generator.generalUsageDocs());
  markdown.push('');

  markdown.push('## API Reference');
  markdown.push('');

  forEachOperation(spec, (entry, operation) => {
    const { method, path } = entry;
    markdown.push(
      `### ${operation['x-fn-name']} | ${`_${method.toUpperCase()} ${path}_`}`,
    );
    markdown.push(operation.summary || '');

    const snippet = generator.snippet(entry, operation);
    markdown.push(`#### Example usage`);
    markdown.push(snippet);

    const requestBodyContent = propEmitter.requestBody(operation.requestBody);
    if (requestBodyContent.length > 1) {
      // Check if more than just the header was added
      markdown.push(requestBodyContent.join('\n\n'));
    }

    markdown.push(`#### Output`);
    for (const status in operation.responses) {
      const response = operation.responses[status];

      if (!isEmpty(response.content)) {
        const contentEntries = Object.entries(response.content);

        if (contentEntries.length === 1) {
          const [contentType, mediaType] = contentEntries[0];
          markdown.push(`**${status}** - ${response.description}`);
          markdown.push(`\n**Content Type:** \`${contentType}\``);

          if (mediaType.schema) {
            const schemaDocs = propEmitter.handle(mediaType.schema);
            markdown.push(...schemaDocs);
          }
        } else {
          // Multiple content types - use collapsible toggle for the entire response
          markdown.push(`<details>`);
          markdown.push(
            `<summary><b>${status}</b>  <i>${response.description}</i></summary>`,
          );

          for (const [contentType, mediaType] of contentEntries) {
            markdown.push(`\n**Content Type:** \`${contentType}\``);
            if (mediaType.schema) {
              const schemaDocs = propEmitter.handle(mediaType.schema);
              markdown.push(...schemaDocs.map((l) => `\n${l}`));
            }
          }

          markdown.push(`</details>`);
        }
      } else {
        // No content - just show status and description
        markdown.push(`**${status}** - ${response.description}`);
      }
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
