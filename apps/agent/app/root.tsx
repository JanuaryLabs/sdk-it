import {
  Links,
  type LinksFunction,
  Meta,
  type MetaFunction,
  Outlet,
  Scripts,
  ScrollRestoration,
} from 'react-router';

import { Toaster, cn } from '@sdk-it/shadcn';
import { loadSpec } from '@sdk-it/spec';

import '../styles.css';
import { useRootData } from './hooks/use-root-data';

export const meta: MetaFunction = () => [
  {
    title: 'Agentic',
  },
];

export const links: LinksFunction = () => [
  { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
  {
    rel: 'preconnect',
    href: 'https://fonts.gstatic.com',
    crossOrigin: 'anonymous',
  },
  {
    rel: 'stylesheet',
    href: `https://fonts.googleapis.com/css2?family=Geist:wght@300..700&display=swap`,
  },
  {
    rel: 'stylesheet',
    href: `https://fonts.googleapis.com/css2?family=Geist+Mono:wght@400..700&display=swap`,
  },
  {
    rel: 'stylesheet',
    href: `https://fonts.googleapis.com/css2?family=Rubik:ital,wght@0,300..900;1,300..900&display=swap`,
  },
];
export function Layout({ children }: { children: React.ReactNode }) {
  const { isDark } = useRootData();

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body className={cn('flex h-full flex-col', isDark ? 'dark' : '')}>
        <Toaster />
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export async function loader({ request }: { request: Request }) {
  const { toIR } = await import('@sdk-it/spec');
  const urlObj = new URL(request.url);
  const specUrl =
    urlObj.searchParams.get('spec') ??
    import.meta.env.VITE_SPEC ??
    (import.meta.env.DEV
      ? // ? '/Users/ezzabuzaid/Desktop/mo/virtual-care/openapi.json'
        'https://api.openstatus.dev/v1/openapi'
      : // ?'https://raw.githubusercontent.com/readmeio/oas-examples/main/3.1/json/petstore.json'
        '');
  const ir = toIR({ spec: await loadSpec(specUrl) });
  return {
    ir,
    isDark: urlObj.searchParams.get('dark') === 'true',
  };
}
