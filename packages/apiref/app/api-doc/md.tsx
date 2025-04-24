import { pluginLineNumbers } from '@expressive-code/plugin-line-numbers';
import { lazy } from 'react';
import rehypeExpressiveCode from 'rehype-expressive-code';
import remarkGfm from 'remark-gfm';

const Markdown = lazy(() =>
  import('react-markdown').then((mod) => ({ default: mod.MarkdownHooks })),
);

export function MD(props: { content?: string }) {
  if (!props.content) {
    return null;
  }
  return (
    <div className="prose prose-sm max-w-none">
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[
          [rehypeExpressiveCode,
            { }],
        ]}
      >
        {props.content}
      </Markdown>
    </div>
  );
}
