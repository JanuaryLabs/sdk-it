import { useEffect } from 'react';
// const ReactMarkdown = lazy(() =>
//   import('react-markdown').then((mod) => ({ default: mod.MarkdownHooks })),
// );

// function parseMarkdownIntoBlocks(markdown?: string): string[] {
//   if (!markdown) {
//     return [];
//   }
//   const tokens = marked.lexer(markdown);
//   return tokens.map((token) => token.raw);
// }

// const MemoizedMarkdownBlock = memo(
//   ({ content, className }: { content: string; className?: string }) => {
//     return (
//       <div className={cn('', className)}>
//         <ReactMarkdown
//           remarkPlugins={[remarkGfm]}
//           rehypePlugins={[
//             [
//               rehypeShiki,
//               {
//                 theme: 'vesper',
//               } satisfies RehypeShikiOptions,
//             ],
//           ]}
//         >
//           {content}
//         </ReactMarkdown>
//       </div>
//     );
//   },
//   (prevProps, nextProps) => {
//     if (prevProps.content !== nextProps.content) return false;
//     return true;
//   },
// );

// MemoizedMarkdownBlock.displayName = 'MemoizedMarkdownBlock';

// export const MD = memo(
//   ({
//     content,
//     className,
//     id,
//   }: {
//     content?: string;
//     className?: string;
//     id: string;
//   }) => {
//     const blocks = useMemo(() => parseMarkdownIntoBlocks(content), [content]);

//     return blocks.map((block, index) => (
//       <MemoizedMarkdownBlock
//         className={className}
//         content={block}
//         key={`${id}-block_${index}`}
//       />
//     ));
//   },
// );

// MD.displayName = 'MD';
import useSWR from 'swr';

import { cleanupWorkerCallback, runWorker } from './use-markdown-worker';

export function MD({
  content,
  className,
  id,
}: {
  content?: string;
  className?: string;
  id: string;
}) {
  const { data, isLoading } = useSWR(id, async () => {
    if (!content) return '';
    const result = await runWorker<{ id: string; content: string }>({
      content,
      id,
    });
    return result.content;
  });
  useEffect(() => {
    return () => {
      cleanupWorkerCallback(id);
    };
  }, [id]);
  if (isLoading) return 'loading...';
  if (!data) return '';

  return (
    <div className={className} dangerouslySetInnerHTML={{ __html: data }}></div>
  );
}
