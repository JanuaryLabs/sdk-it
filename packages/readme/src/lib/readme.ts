import { isEmpty } from '@sdk-it/core';
import {
  type OperationEntry,
  type OurOpenAPIObject,
  type TunedOperationObject,
  forEachOperation,
} from '@sdk-it/spec';

import { PropEmitter } from './prop.emitter.ts';

export function toReadme(
  spec: OurOpenAPIObject,
  generators: {
    generateSnippet: (
      entry: OperationEntry,
      operation: TunedOperationObject,
    ) => string;
  },
) {
  // table of content is the navigation headers in apiref
  const markdown: string[] = [];
  const propEmitter = new PropEmitter(spec);

  forEachOperation(spec, (entry, operation) => {
    const { method, path, name } = entry;
    markdown.push(
      `#### ${name || operation.operationId} | ${`_${method.toUpperCase()} ${path}_`}`,
    );
    markdown.push(operation.summary || '');

    const snippet = generators.generateSnippet(entry, operation);
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
  });
  return markdown.join('\n\n');
}
