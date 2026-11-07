import { SidebarProvider } from '@zukhruf/shadcn';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  StaticRouterProvider,
  createStaticHandler,
  createStaticRouter,
} from 'react-router';
import { describe, expect, test } from 'vitest';

import { NavMain } from './nav.tsx';

async function renderSidebarLinks(url: string) {
  const { query, dataRoutes } = createStaticHandler([
    {
      // SidebarItem reads the root route's loader data through useRootData.
      id: 'root',
      path: '/',
      loader: () => ({ operationsMap: {} }),
      Component: () => (
        <SidebarProvider>
          <NavMain
            items={[
              {
                id: 'docs',
                category: 'Docs',
                items: [{ id: 'page', title: 'Page', url }],
              },
            ]}
          />
        </SidebarProvider>
      ),
    },
  ]);
  const context = await query(new Request('http://localhost/'));
  if (context instanceof Response) {
    throw new Error(`The root route answered ${context.status}`);
  }
  const html = renderToStaticMarkup(
    <StaticRouterProvider
      router={createStaticRouter(dataRoutes, context)}
      context={context}
      hydrate={false}
    />,
  );
  return html.match(/<a\b[^>]*>/g) ?? [];
}

describe('sidebar item link', () => {
  test.each([
    'https://example.com/docs',
    'http://example.com/docs',
    'HTTPS://EXAMPLE.COM/docs',
    '//example.com/docs',
  ])('%s opens in a new tab without an opener', async (url) => {
    const [link, ...rest] = await renderSidebarLinks(url);

    expect(rest).toEqual([]);
    expect(link).toContain('target="_blank"');
    expect(link).toContain('rel="noopener noreferrer"');
  });

  test.each([
    '/getting-started',
    'guide',
    'mailto:team@example.com',
    'javascript:alert(1)',
    'ftp://example.com/file',
  ])('%s opens in the same tab', async (url) => {
    const [link, ...rest] = await renderSidebarLinks(url);

    expect(rest).toEqual([]);
    expect(link).toMatch(/^<a\b/);
    expect(link).not.toContain('target=');
    expect(link).not.toContain('rel=');
  });

  test('an empty url renders no link', async () => {
    expect(await renderSidebarLinks('')).toEqual([]);
  });
});
