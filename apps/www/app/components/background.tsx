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
        <div className="z-10 flex h-full w-full flex-col items-center">
          <div className="mx-auto flex h-full w-full flex-col items-center justify-center gap-8">
            <div className="relative flex h-full w-full flex-col items-start justify-center gap-4">
              {props.children}
            </div>
          </div>
        </div>
      </GridBackgroundDemo>
    </div>
  );
}

export function GridBackgroundDemo(
  props: PropsWithChildren<{ className?: string }>,
) {
  return (
    <div
      className={cn(
        'bg-grid-small-black/[0.1] dark:bg-grid-small-white/[0.1] bg-background dark:bg-background relative h-full w-full',
        props.className,
      )}
    >
      <div className="bg-background dark:bg-background pointer-events-none absolute inset-0 flex h-full items-center justify-center [mask-image:radial-gradient(ellipse_at_center,transparent_20%,black)]"></div>
      {props.children}
    </div>
  );
}
