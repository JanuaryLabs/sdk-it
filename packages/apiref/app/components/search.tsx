import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '../shadcn/command';
import { useRootData } from '../use-root-data';

export function SearchCmdk() {
  const { sidebar, operationsMap, spec } = useRootData();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((open) => !open);
      }
    };

    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, []);

  return (
    <>
      <p className="text-muted-foreground text-sm">
        Press{' '}
        <kbd className="bg-muted text-muted-foreground pointer-events-none inline-flex h-5 items-center gap-1 rounded border px-1.5 font-mono text-[10px] font-medium opacity-100 select-none">
          <span className="text-xs">⌘</span>J
        </kbd>
      </p>
      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Type a command or search..." />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          {sidebar.map((category) => (
            <CommandGroup heading={category.category} key={category.category}>
              {category.items.map((item) => (
                <React.Fragment key={item.id}>
                  {/* Parent item as non-selectable header */}
                  <CommandItem disabled className="pl-2 opacity-80">
                    <span className="font-medium">{item.title}</span>
                  </CommandItem>
                  {/* Child endpoints */}
                  {item.items?.map((child) => (
                    <CommandItem
                      key={child.id}
                      className="pl-6"
                      onSelect={() => {
                        setOpen(false);
                        navigate(import.meta.env.BASE_URL + child.url);
                      }}
                    >
                      <span>{child.title}</span>
                      <CommandShortcut>{child.url}</CommandShortcut>
                    </CommandItem>
                  ))}
                </React.Fragment>
              ))}
            </CommandGroup>
          ))}
        </CommandList>
      </CommandDialog>
    </>
  );
}
