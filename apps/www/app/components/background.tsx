import { type PropsWithChildren } from 'react';

import { cn } from '../shadcn';

export default function Background(
  props: React.PropsWithChildren<{ className?: string }>,
) {
  return (
    <div
      className={cn(
        'relative flex w-full items-center justify-center',
        props.className,
      )}
    >
      <GridBackgroundDemo className="w-full">
        <div className="z-10 flex w-full flex-col items-center">
          <div className="mx-auto flex h-full w-full flex-col items-center justify-center gap-8 pt-16">
            <div className="relative flex w-full flex-col items-start justify-center gap-4">
              {props.children}
            </div>
          </div>
        </div>
      </GridBackgroundDemo>
    </div>
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
        'bg-grid-small-black/[0.1] dark:bg-grid-small-white/[0.1] bg-background dark:bg-background relative w-full',
        props.className,
      )}
    >
      <div className="bg-background dark:bg-background pointer-events-none absolute inset-0 flex items-center justify-center [mask-image:radial-gradient(ellipse_at_center,transparent_20%,black)]"></div>
      {props.children}
    </div>
  );
}
