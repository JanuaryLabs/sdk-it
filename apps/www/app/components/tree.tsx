import {
  ChevronDown,
  ChevronRight,
  Code,
  Code2,
  Folder,
  FolderOpen,
  Search,
} from 'lucide-react';
import React, { useMemo, useState } from 'react';

import { cn } from '../shadcn';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../shadcn/lib/ui/collapsible';
import { Input } from '../shadcn/lib/ui/input';

export interface TreeItem {
  id: string;
  name: string;
  type: 'file' | 'folder';
  children?: TreeItem[];
  value?: any;
}

interface TreeViewProps {
  data: TreeItem[];
  onItemSelect?: (item: TreeItem) => void;
  onLeafSelect?: (item: TreeItem) => void;
  onBranchSelect?: (item: TreeItem) => void;
  selectedId?: string;
  className?: string;
  showSearch?: boolean;
  searchPlaceholder?: string;
}

interface TreeItemProps {
  item: TreeItem;
  depth?: number;
  onSelect?: (item: TreeItem) => void;
  onLeafSelect?: (item: TreeItem) => void;
  onBranchSelect?: (item: TreeItem) => void;
  selectedId?: string;
  searchQuery?: string;
}

function TreeItemComponent({
  item,
  depth = 0,
  onSelect,
  onLeafSelect,
  onBranchSelect,
  selectedId,
  searchQuery = '',
}: TreeItemProps) {
  const [isOpen, setIsOpen] = useState(true); // Default to open
  const hasChildren = item.children && item.children.length > 0;
  const isSelected = selectedId === item.id;

  // Check if item matches search
  const matchesSearch =
    !searchQuery || item.name.toLowerCase().includes(searchQuery.toLowerCase());

  // Check if any children match search
  const hasMatchingChildren = useMemo(() => {
    if (!searchQuery || !item.children) return false;

    const checkChildren = (items: TreeItem[]): boolean => {
      return items.some(
        (child) =>
          child.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (child.children && checkChildren(child.children)),
      );
    };

    return checkChildren(item.children);
  }, [item.children, searchQuery]);

  // Auto-expand if has matching children
  React.useEffect(() => {
    if (hasMatchingChildren && searchQuery) {
      setIsOpen(true);
    }
  }, [hasMatchingChildren, searchQuery]);

  // Don't render if doesn't match search and has no matching children
  if (searchQuery && !matchesSearch && !hasMatchingChildren) {
    return null;
  }

  const handleSelect = () => {
    // Call the general onSelect handler
    if (onSelect) {
      onSelect(item);
    }

    // Call specific handlers based on item type
    if (hasChildren) {
      if (onBranchSelect) {
        onBranchSelect(item);
      }
      setIsOpen(!isOpen);
    } else {
      if (onLeafSelect) {
        onLeafSelect(item);
      }
    }
  };

  if (!hasChildren) {
    return (
      <div
        className={cn(
          'hover:bg-accent/50 flex cursor-pointer items-center gap-2 rounded-md py-2 transition-colors',
          isSelected && 'bg-accent',
          'text-sm',
        )}
        style={{ marginLeft: `${depth * 16}px` }}
        onClick={handleSelect}
      >
        <div className="w-4 flex-shrink-0" /> {/* Spacer for alignment */}
        {isSelected ? (
          <Code2 className="text-muted-foreground size-4 flex-shrink-0" />
        ) : (
          <Code className="text-muted-foreground size-4 flex-shrink-0" />
        )}
        <span className="truncate px-1">{item.name}</span>
      </div>
    );
  }

  return (
    <div style={{ marginLeft: `${depth * 16}px` }}>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <div
            className={cn(
              'hover:bg-accent/50 flex w-full cursor-pointer items-center gap-2 rounded-md py-2 transition-colors',
              isSelected && 'bg-accent',
              'text-sm',
            )}
            onClick={handleSelect}
          >
            {isOpen ? (
              <ChevronDown className="text-muted-foreground size-4 flex-shrink-0" />
            ) : (
              <ChevronRight className="text-muted-foreground size-4 flex-shrink-0" />
            )}
            {isOpen ? (
              <FolderOpen className="text-muted-foreground size-4 flex-shrink-0" />
            ) : (
              <Folder className="text-muted-foreground size-4 flex-shrink-0" />
            )}
            <span className="truncate px-1 font-mono font-medium capitalize">
              {item.name}
            </span>
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-1">
          <div className="space-y-1">
            {item.children?.map((child) => (
              <TreeItemComponent
                key={child.id}
                item={child}
                depth={depth + 1}
                onSelect={onSelect}
                onLeafSelect={onLeafSelect}
                onBranchSelect={onBranchSelect}
                selectedId={selectedId}
                searchQuery={searchQuery}
              />
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

export function TreeView({
  data,
  onItemSelect,
  onLeafSelect,
  onBranchSelect,
  selectedId,
  className,
  showSearch = false,
  searchPlaceholder = 'Search...',
}: TreeViewProps) {
  const [searchQuery, setSearchQuery] = useState('');

  return (
    <div className={cn('space-y-2', className)}>
      {showSearch && (
        <div className="relative">
          <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            placeholder={searchPlaceholder}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
      )}
      <div className="space-y-1">
        {data.map((item) => (
          <TreeItemComponent
            key={item.id}
            item={item}
            onSelect={onItemSelect}
            onLeafSelect={onLeafSelect}
            onBranchSelect={onBranchSelect}
            selectedId={selectedId}
            searchQuery={searchQuery}
          />
        ))}
      </div>
    </div>
  );
}
