import { Search } from 'lucide-react';
import React, { Fragment, useEffect, useState } from 'react';
import { VscCopilot } from 'react-icons/vsc';

import { OperationCard } from '../api-doc/operation-card';
import { Badge } from '../shadcn/badge';
import { Button } from '../shadcn/button';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '../shadcn/command';
import { useRootData } from '../use-root-data';
import { AskAi } from './ai';

const aiValue = crypto.randomUUID();

export function SearchCmdk() {
  // const { containerRef } = useScrollToBottom();
  const { sidebar, operationsMap } = useRootData();
  const [open, setOpen] = useState(false);
  const [selectedOperationId, setSelectedOperationId] = useState<string | null>(
    aiValue,
  );
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
      <Button
        variant={'ghost'}
        className="bg-border text-muted-foreground hover:bg-sidebar-primary/10 flex items-center justify-between px-3"
        onClick={() => setOpen((open) => !open)}
      >
        <div className="flex items-center gap-2">
          <Search />
          Search
        </div>
        <kbd className="bg-muted text-muted-foreground pointer-events-none inline-flex h-5 items-center gap-1 rounded border px-1.5 font-mono text-[10px] font-medium opacity-100 select-none">
          <span className="text-xs">⌘</span>K
        </kbd>
      </Button>
      <CommandDialog
        open={open}
        onOpenChange={(newOpen) => {
          setOpen(newOpen);
          // if (!newOpen) {
          //   setSelectedOperationId(null);
          // }
        }}
      >
        <CommandInput placeholder="Type a command or search..." />
        <div className="flex h-full overflow-auto">
          {/* Left Pane - Search UI */}
          <CommandList className="h-full max-h-full w-2/5 sm:w-1/4">
            <CommandGroup forceMount={true} heading="Help">
              <CommandItem
                value={aiValue}
                className="cursor-pointer space-x-2"
                forceMount={true}
                onSelect={() => {
                  setSelectedOperationId(aiValue);
                }}
                onMouseEnter={() => setSelectedOperationId(aiValue)}
              >
                <VscCopilot size={18} />
                <span>Ask AI</span>
              </CommandItem>
            </CommandGroup>
            <CommandEmpty>No results found.</CommandEmpty>
            {sidebar.map((category) => (
              <Fragment key={category.category}>
                <CommandGroup heading={category.category}>
                  {category.items.map((item) => (
                    <React.Fragment key={item.id}>
                      {/* <CommandItem disabled className="pl-2 opacity-80">
                        <span className="font-medium">{item.title}</span>
                      </CommandItem> */}
                      {item.items?.map((child) => {
                        const operationId = child.url.split('/').pop() || '';
                        return (
                          <CommandItem
                            key={child.id}
                            className="flex flex-col items-start gap-0 p-0 pl-6"
                            onSelect={() => {
                              window.history.replaceState(
                                null,
                                '',
                                `${import.meta.env.BASE_URL}${child.url}`,
                              );
                              const element = document.getElementById(child.id);
                              if (element) {
                                element.scrollIntoView({
                                  behavior: 'instant',
                                  block: 'start',
                                  inline: 'nearest',
                                });
                              }
                              setOpen(false);
                            }}
                            onMouseEnter={() =>
                              setSelectedOperationId(operationId)
                            }
                          >
                            <span>{child.title}</span>
                            <div className="flex items-center">
                              <Badge
                                variant={'ghost'}
                                className="text-muted-foreground gap-x-1 truncate px-0 font-mono text-[10px] hover:bg-transparent"
                              >
                                <span>
                                  {operationsMap[
                                    operationId
                                  ].entry.method.toUpperCase()}
                                </span>
                                <span className="font-normal">
                                  {operationsMap[operationId].entry.path}
                                </span>
                              </Badge>
                            </div>
                          </CommandItem>
                        );
                      })}
                    </React.Fragment>
                  ))}
                </CommandGroup>
              </Fragment>
            ))}
          </CommandList>

          {/* Right Pane - Operation Card */}
          {selectedOperationId ? (
            <div className="relative h-full w-2/5 overflow-auto border-l px-4 sm:block sm:w-3/4">
              {selectedOperationId === aiValue ? (
                <AskAi
                  key={'ai'}
                  className="flex h-full flex-col justify-between"
                />
              ) : (
                operationsMap[selectedOperationId] && (
                  <OperationCard
                    entry={operationsMap[selectedOperationId].entry}
                    operation={operationsMap[selectedOperationId].operation}
                  />
                )
              )}
            </div>
          ) : null}
        </div>
      </CommandDialog>
    </>
  );
}
