import rehypeShiki, { type RehypeShikiOptions } from '@shikijs/rehype';
import rehypeStringify from 'rehype-stringify';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';

const processor = unified()
  .use(remarkParse)
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeShiki, {
    defaultColor: 'light',
    cssVariablePrefix: '--shiki-',
    themes: {
      light: 'min-light',
      dark: 'vesper',
    },
    langs: ['typescript', 'dart', 'shell', 'json'],
  } satisfies RehypeShikiOptions)
  .use(rehypeStringify);
onmessage = (event) => {
  (async () => {
    const { id, content: markdown } = event.data;
    const file = await processor.process(markdown);
    const htmlContent = file.toString();
    if (htmlContent?.length === 0 && markdown?.length > 0) {
      console.warn(
        `[Worker ${id}] Warning: Markdown was processed into empty HTML. Original markdown:`,
        markdown,
      );
    }
    if (file.messages.length > 0) {
      console.warn(
        `[Worker ${id}] Messages from unified processing:`,
        file.messages,
      );
    }
    postMessage({ id, content: htmlContent.toString() });
  })();
};
