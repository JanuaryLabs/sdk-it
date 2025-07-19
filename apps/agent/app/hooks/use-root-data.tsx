import { useRouteLoaderData } from 'react-router';

type RootLoaderData = Awaited<ReturnType<typeof import('../root').loader>>;

export function useRootData() {
  return useRouteLoaderData<RootLoaderData>('root')!;
}
