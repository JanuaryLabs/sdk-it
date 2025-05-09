import rehypeShiki, { type RehypeShikiOptions } from '@shikijs/rehype';
import { marked } from 'marked';
import { lazy, memo, useMemo } from 'react';
import remarkGfm from 'remark-gfm';
import { cn } from '../shadcn/cn';

const ReactMarkdown = lazy(() =>
  import('react-markdown').then((mod) => ({ default: mod.MarkdownHooks })),
);

function parseMarkdownIntoBlocks(markdown?: string): string[] {
  if (!markdown) {
    return [];
  }
  const tokens = marked.lexer(markdown);
  return tokens.map((token) => token.raw);
}

const MemoizedMarkdownBlock = memo(
  ({ content, className }: { content: string; className?: string }) => {
    return (
      <div className={cn('', className)}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[
            [
              rehypeShiki,
              {
                // themes: {
                //   light: 'min-light',
                //   dark: 'vesper',
                // },
                theme:'vesper'
              } satisfies RehypeShikiOptions,
              // {
              //   themes: ['min-light'],
              // },
              // {
              //   themes: ['vesper', 'snazzy-light'],
              // } satisfies RehypeExpressiveCodeOptions,
            ],
          ]}
        >
          {content}
        </ReactMarkdown>
      </div>
    );
  },
  (prevProps, nextProps) => {
    if (prevProps.content !== nextProps.content) return false;
    return true;
  },
);

MemoizedMarkdownBlock.displayName = 'MemoizedMarkdownBlock';

export const MD = memo(
  ({
    content,
    className,
    id,
  }: {
    content?: string;
    className?: string;
    id: string;
  }) => {
    const blocks = useMemo(() => parseMarkdownIntoBlocks(content), [content]);

    return blocks.map((block, index) => (
      <MemoizedMarkdownBlock
        className={className}
        content={block}
        key={`${id}-block_${index}`}
      />
    ));
  },
);

MD.displayName = 'MD';
