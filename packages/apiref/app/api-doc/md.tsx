import { useEffect } from 'react';

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
