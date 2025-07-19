import { Button, type ButtonProps, cn } from '@sdk-it/shadcn';

export const EyeCatchingButton = ({ ...props }: ButtonProps) => {
  return (
    <div className="group relative overflow-hidden rounded-full border border-zinc-400 p-0.5 shadow dark:border-zinc-800 dark:bg-zinc-900">
      <span className="absolute inset-[-1000%] animate-[spin_7.5s_linear_infinite_reverse] bg-[conic-gradient(from_90deg_at_50%_50%,#000_0%,#fff_5%)] group-hover:bg-none dark:bg-[conic-gradient(from_90deg_at_50%_50%,#fff_0%,#09090B_7%)]" />
      <Button
        variant={'ghost'}
        {...props}
        className={cn(
          'w-full rounded-full bg-zinc-50 font-medium backdrop-blur-xl dark:bg-zinc-900',
          props.className,
        )}
      />
    </div>
  );
};
