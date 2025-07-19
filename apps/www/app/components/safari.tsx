import { Minus, Square, X } from 'lucide-react';

import { cn } from '@sdk-it/shadcn';

export interface SafariProps {
  className?: string;
  children?: React.ReactNode;
  title?: string;
}

export function Safari({
  className,
  children,
  title = '',
  ...props
}: SafariProps) {
  return (
    <div className={cn('w-full', className)} {...props}>
      <div className="bg-muted flex items-center justify-between rounded-t-lg border-b px-3 py-4">
        <div className="flex items-center space-x-3">
          <button className="group flex h-3 w-3 items-center justify-center rounded-full bg-green-500 hover:bg-green-400">
            <Square className="h-1.5 w-1.5 text-green-900 opacity-0 transition-opacity group-hover:opacity-100" />
          </button>
          <button className="group flex h-3 w-3 items-center justify-center rounded-full bg-yellow-500 hover:bg-yellow-400">
            <Minus className="h-2 w-2 text-yellow-900 opacity-0 transition-opacity group-hover:opacity-100" />
          </button>
          <button className="group flex h-3 w-3 items-center justify-center rounded-full bg-red-500 hover:bg-red-400">
            <X className="h-2 w-2 text-red-900 opacity-0 transition-opacity group-hover:opacity-100" />
          </button>
        </div>
        <div className="flex flex-1 justify-center">
          <div className="text-sm text-gray-700 dark:text-gray-400">
            <span className="truncate">{title}</span>
          </div>
        </div>
        <div className="w-16"></div>
      </div>
      {children}
    </div>
  );
}
