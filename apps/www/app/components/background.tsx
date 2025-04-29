import { type PropsWithChildren, useEffect, useState } from 'react';
import { AiOutlineThunderbolt } from 'react-icons/ai';

import { buttonVariants, cn } from '../shadcn';

export default function Background(
  props: React.PropsWithChildren<{ className?: string }>,
) {
  return (
    <>
      <Nav />
      <div
        className={cn(
          'relative flex w-full items-center justify-center py-10',
          props.className,
        )}
      >
        <GridBackgroundDemo className="w-full">
          <div className="z-10 flex w-full flex-col items-center">
            <div className="mx-auto flex h-full w-full flex-col items-center justify-center gap-8 py-16">
              <div className="relative flex w-full flex-col items-start justify-center gap-4">
                {props.children}
              </div>
            </div>
          </div>
        </GridBackgroundDemo>
      </div>
    </>
  );
}

function Logo() {
  return (
    <a href="/" className="mr-6 flex items-center gap-x-2">
      <AiOutlineThunderbolt className="size-5" />
      <p className="font-mono font-bold md:text-lg">
        Serveri<span className="inline-block">z</span>e
      </p>
    </a>
  );
}

export function Nav(props: { className?: string }) {
  const items = [
    {
      name: 'VSCode Ext',
      href: 'https://marketplace.visualstudio.com/items?itemName=january.serverize',
      target: '_blank',
    },
    {
      name: 'Docs',
      href: '/docs',
    },
    {
      name: 'Roadmap',
      href: 'https://github.com/JanuaryLabs/serverize/issues?q=is:issue+label:%22Feature+request%22+sort:created-desc',
      target: '_blank',
      className: 'lg:hidden',
    },
    {
      name: 'Guides',
      href: '/guides',
      className: 'md:hidden lg:block',
    },
    {
      name: 'Feedback',
      href: 'https://github.com/JanuaryLabs/serverize/issues/new',
      target: '_blank',
    },
  ];
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 0);
    };
    window.addEventListener('scroll', handleScroll);
    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);
  return (
    <header
      className={cn(
        'flex w-full items-center py-3',
        'bg-background dark:bg-background',
        props.className,
        'fixed top-0 z-50 w-full',
        scrolled ? 'border-border/70 border-b' : '',
        'px-4 md:px-6',
      )}
    >
      <div className="mx-auto flex w-full max-w-[1400px] items-center">
        <Logo />
        <nav className="hidden items-center lg:flex">
          {items.map((it) => (
            <a
              key={it.name}
              href={it.href}
              target={it.target}
              className={cn(
                buttonVariants({ variant: 'ghost' }),
                'text-secondary-foreground/70 text-sm font-medium',
                it.className,
              )}
            >
              {it.name}
            </a>
          ))}
        </nav>
        <div className="ml-auto flex items-center">
          <a
            href="https://cal.com/january-sh/30min"
            target="_blank"
            className={cn(
              buttonVariants({ variant: 'default' }),
              'h-8 px-2.5 py-1 shadow-none',
              'hidden lg:flex',
              'mr-3 md:mr-4',
            )}
            rel="noreferrer"
          >
            Contact
          </a>
          <a
            href="/docs"
            className={cn(
              buttonVariants({ variant: 'default' }),
              'h-8 px-2.5 py-1 shadow-none',
              'flex lg:hidden',
              'mr-3 md:mr-4',
            )}
          >
            Docs
          </a>
          {/* <a
            href="/guides"
            className={cn(
              buttonVariants({ variant: 'default' }),
              'h-8 px-2.5 py-1 shadow-none',
              'flex lg:hidden',
              'mr-3 md:mr-4',
            )}
          >
            Guides
          </a> */}
          <div className="flex items-center gap-x-3 md:gap-x-4">
            <SocialMedia />
          </div>
        </div>
      </div>
    </header>
  );
}

function MenuIcon(props: PropsWithChildren<{ className?: string }>) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="4" x2="20" y1="12" y2="12" />
      <line x1="4" x2="20" y1="6" y2="6" />
      <line x1="4" x2="20" y1="18" y2="18" />
    </svg>
  );
}

function MountainIcon(props: PropsWithChildren<{ className?: string }>) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m8 3 4 8 5-5 5 15H2L8 3z" />
    </svg>
  );
}

export function GridBackgroundDemo(
  props: PropsWithChildren<{ className?: string }>,
) {
  return (
    <div
      className={cn(
        'bg-grid-small-black/[0.1] dark:bg-grid-small-white/[0.1] relative w-full bg-white dark:bg-black',
        props.className,
      )}
    >
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-white [mask-image:radial-gradient(ellipse_at_center,transparent_20%,black)] dark:bg-black"></div>
      {props.children}
    </div>
  );
}

function SocialMedia() {
  return (
    <>
      {/* <a
                href="https://github.com/web-infra-dev/rsbuild"
                target="_blank"
                rel="noopener noreferrer"
                className="social-links"
              >
                <div className="social-links-icon_93d67">
                  <svg
                    role="img"
                    viewBox="0 0 24 24"
                    width="24"
                    height="24"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <title>GitHub</title>
                    <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"></path>
                  </svg>
                </div>
              </a> */}
      <a
        href="https://linkedin.com/company/Januarylabs/"
        target="_blank"
        rel="noopener noreferrer"
        className="social-links"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="24"
          height="24"
          fill="#0a66c2"
          className="mercado-match"
          data-supported-dps="24x24"
          viewBox="0 0 24 24"
        >
          <path d="M20.5 2h-17A1.5 1.5 0 002 3.5v17A1.5 1.5 0 003.5 22h17a1.5 1.5 0 001.5-1.5v-17A1.5 1.5 0 0020.5 2zM8 19H5v-9h3zM6.5 8.25A1.75 1.75 0 118.3 6.5a1.78 1.78 0 01-1.8 1.75zM19 19h-3v-4.74c0-1.42-.6-1.93-1.38-1.93A1.74 1.74 0 0013 14.19a.66.66 0 000 .14V19h-3v-9h2.9v1.3a3.11 3.11 0 012.7-1.4c1.55 0 3.36.86 3.36 3.66z"></path>
        </svg>
      </a>
      <a
        href="https://discord.gg/aj9bRtrmNt"
        target="_blank"
        rel="noopener noreferrer"
        className="social-links"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 127.14 96.36"
          fill="#5865F2"
          className="size-6"
        >
          <g data-name="图层 2">
            <g data-name="Discord Logos">
              <path
                d="M107.7 8.07A105.15 105.15 0 0081.47 0a72.06 72.06 0 00-3.36 6.83 97.68 97.68 0 00-29.11 0A72.37 72.37 0 0045.64 0a105.89 105.89 0 00-26.25 8.09C2.79 32.65-1.71 56.6.54 80.21a105.73 105.73 0 0032.17 16.15 77.7 77.7 0 006.89-11.11 68.42 68.42 0 01-10.85-5.18c.91-.66 1.8-1.34 2.66-2a75.57 75.57 0 0064.32 0c.87.71 1.76 1.39 2.66 2a68.68 68.68 0 01-10.87 5.19 77 77 0 006.89 11.1 105.25 105.25 0 0032.19-16.14c2.64-27.38-4.51-51.11-18.9-72.15zM42.45 65.69C36.18 65.69 31 60 31 53s5-12.74 11.43-12.74S54 46 53.89 53s-5.05 12.69-11.44 12.69zm42.24 0C78.41 65.69 73.25 60 73.25 53s5-12.74 11.44-12.74S96.23 46 96.12 53s-5.04 12.69-11.43 12.69z"
                data-name="Discord Logo - Large - White"
              ></path>
            </g>
          </g>
        </svg>
      </a>
    </>
  );
}
