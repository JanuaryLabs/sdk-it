import { cn } from 'cn';

import { MD } from '../api-doc/markdown';

export function Description(props: {
  description: string | undefined;
  varient?: 'sm' | 'default';
  className?: string;
}) {
  return (
    props.description && (
      <MD
        content={props.description}
        className={cn(
          'text-muted-foreground text-sm',
          props.varient === 'sm' ? 'text-xs' : 'text-sm',
          props.className,
        )}
      />
    )
  );
}
