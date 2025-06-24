import { Search } from 'lucide-react';
import React, { Fragment, useState } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
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
  useHotkeys('mod+k', () => setOpen((open) => !open));

  return (
    <>
      <Button
        variant={'ghost'}
        size={'lg'}
        className="text-muted-foreground hover:bg-sidebar-primary/10 flex items-center justify-between border px-3 font-normal"
        onClick={() => setOpen((open) => !open)}
      >
        <div className="flex items-center gap-2">
          <Search />
          Find something...
        </div>
        <kbd className="pointer-events-none inline-flex h-5 items-center gap-1 rounded border px-1.5 font-mono text-[10px] font-medium opacity-100 select-none">
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
            {sidebar.slice(1).map((category) => (
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
                                className="text-muted-foreground line-clamp-2 flex gap-x-1 px-0 font-mono text-[10px] hover:bg-transparent"
                              >
                                <span className="uppercase">
                                  {operationsMap[operationId].entry.method}
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
                    className="text-sm"
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
