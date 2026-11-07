import { useRouteLoaderData } from 'react-router';

type RootLoaderData = Awaited<ReturnType<typeof import('./root.tsx').loader>>;

export function useRootData() {
  return useRouteLoaderData<RootLoaderData>('root')!;
}
