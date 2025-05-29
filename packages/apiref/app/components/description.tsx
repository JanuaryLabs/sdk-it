import { MD } from '../api-doc/md';
import { cn } from '../shadcn/cn';

export function Description(props: {
  id?: string;
  description: string | undefined;
  varient?: 'sm' | 'default';
  className?: string;
}) {
  return (
    props.description && (
      <MD
        id={props.id || props.description}
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
