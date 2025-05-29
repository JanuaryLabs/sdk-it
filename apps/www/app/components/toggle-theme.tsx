import { Moon, Sun } from 'lucide-react';
import { useLocalStorage } from 'usehooks-ts';

import { cn } from '../shadcn';
import useCookie from '../shadcn/lib/hooks/use-cookie';
import { useRootData } from '../use-root-data';

interface ThemeToggleProps {
  className?: string;
}

export function useTheme() {
  const { isDark: initialIsDark } = useRootData();
  const [theme, setTheme] = useCookie('theme');
  const [readLocal, setLocal] = useLocalStorage(
    'theme',
    initialIsDark ? 'dark' : 'light',
  );
  const toggleTheme = () => {
    const method = theme === 'dark' ? 'remove' : 'add';
    document.body.classList[method]('dark');
    console.log(theme);
    setTheme(theme === 'dark' ? 'light' : 'dark');
    setLocal(theme === 'dark' ? 'light' : 'dark');
  };
  return {
    isDark: readLocal === 'dark',
    toggleTheme,
    theme: readLocal,
  };
}

export function ThemeToggle({ className }: ThemeToggleProps) {
  const { isDark, theme, toggleTheme } = useTheme();

  const handleToggle = () => {
    const method = theme === 'dark' ? 'remove' : 'add';
    document.body.classList[method]('dark');
    toggleTheme();
  };

  return (
    <div
      className={cn(
        'flex h-8 w-16 cursor-pointer rounded-full p-1 transition-all duration-300',
        isDark ? 'border' : 'border',
        className,
      )}
      onClick={handleToggle}
      role="button"
      tabIndex={0}
    >
      <div className="flex w-full items-center justify-between">
        <div
          className={cn(
            'flex h-6 w-6 items-center justify-center rounded-full transition-transform duration-300',
            isDark
              ? 'translate-x-0 transform bg-zinc-800'
              : 'translate-x-8 transform bg-gray-200',
          )}
        >
          {isDark ? (
            <Moon className="size-4 text-white" strokeWidth={1.5} />
          ) : (
            <Sun className="size-4 text-gray-700" strokeWidth={1.5} />
          )}
        </div>
        <div
          className={cn(
            'flex h-6 w-6 items-center justify-center rounded-full transition-transform duration-300',
            isDark ? 'bg-transparent' : '-translate-x-8 transform',
          )}
        >
          {isDark ? (
            <Sun className="size-4 text-gray-500" strokeWidth={1.5} />
          ) : (
            <Moon className="size-4 text-black" strokeWidth={1.5} />
          )}
        </div>
      </div>
    </div>
  );
}
