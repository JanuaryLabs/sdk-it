import { lazy } from 'react';
import rehypeExpressiveCode from 'rehype-expressive-code';
import remarkGfm from 'remark-gfm';

import { cn } from '../shadcn/cn';

const Markdown = lazy(() =>
  import('react-markdown').then((mod) => ({ default: mod.MarkdownHooks })),
);

export function MD(props: { content?: string; className?: string }) {
  if (!props.content) {
    return null;
  }
  return (
    <div className={cn('prose prose-sm max-w-none', props.className)}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeExpressiveCode]]}
      >
        {props.content}
      </Markdown>
    </div>
  );
}
