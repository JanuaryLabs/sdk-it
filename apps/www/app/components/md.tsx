import { marked } from 'marked';
import { lazy, memo, useMemo } from 'react';
import rehypeExpressiveCode, {
  type RehypeExpressiveCodeOptions,
} from 'rehype-expressive-code';
import remarkGfm from 'remark-gfm';

const ReactMarkdown = lazy(() =>
  import('react-markdown').then((mod) => ({ default: mod.MarkdownHooks })),
);
function parseMarkdownIntoBlocks(markdown: string): string[] {
  if (!markdown) {
    return [];
  }
  const tokens = marked.lexer(markdown);
  return tokens.map((token) => token.raw);
}

const MemoizedMarkdownBlock = memo(
  ({ content }: { content: string }) => {
    return (
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[
          [
            rehypeExpressiveCode,
            {
              themes: ['vesper', 'snazzy-light'],
            } satisfies RehypeExpressiveCodeOptions,
          ],
        ]}
      >
        {content}
      </ReactMarkdown>
    );
  },
  (prevProps, nextProps) => {
    if (prevProps.content !== nextProps.content) return false;
    return true;
  },
);

MemoizedMarkdownBlock.displayName = 'MemoizedMarkdownBlock';

export const MD = memo(({ content, id }: { content: string; id: string }) => {
  const blocks = useMemo(() => parseMarkdownIntoBlocks(content), [content]);

  return blocks.map((block, index) => (
    <MemoizedMarkdownBlock content={block} key={`${id}-block_${index}`} />
  ));
});

MD.displayName = 'MD';
