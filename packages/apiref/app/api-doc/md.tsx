import { lazy } from 'react';
import rehypeExpressiveCode from 'rehype-expressive-code';
import remarkGfm from 'remark-gfm';

const Markdown = lazy(() =>
  import('react-markdown').then((mod) => ({ default: mod.MarkdownAsync })),
);

export function MD(props: { content?: string }) {
  if (!props.content) {
    return null;
  }
  return (
    <div className="prose prose-sm max-w-none">
      <Markdown
        rehypePlugins={[[rehypeExpressiveCode, {}]]}
        remarkPlugins={[remarkGfm]}
      >
        {props.content}
      </Markdown>
    </div>
  );
}
