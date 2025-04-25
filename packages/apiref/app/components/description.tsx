import { MD } from '../api-doc/md';
import { cn } from '../shadcn/cn';

export function Description(props: {
  description?: string;
  varient?: 'sm' | 'default';
}) {
  return (
    props.description && (
      <MD
        content={props.description}
        className={cn(
          'text-sm text-muted-foreground',
          props.varient === 'sm' ? 'text-xs' : 'text-sm',
        )}
      />
    )
  );
}
