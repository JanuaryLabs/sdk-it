import { MD } from '../api-doc/md';
import { cn } from '../shadcn/cn';

export function Description(props: {
  description?: string;
  varient?: 'sm' | 'default';
  className?: string;
}) {
  return (
    props.description && (
      <MD
        id=""
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
