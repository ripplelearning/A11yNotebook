// Accessible filesystem tree for vault notebooks, Markdown notes, and attachments.
import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { VaultEntry } from '../../../shared/types';

interface VaultTreeProps {
  entries: VaultEntry[];
  selectedPath: string | null;
  onSelect: (entry: VaultEntry) => void;
  onOpen: (entry: VaultEntry) => void;
  onRename: (path: string, name: string) => void;
  onDelete: (path: string) => void;
}

interface VisibleEntry {
  entry: VaultEntry;
  level: number;
}

function visibleEntries(entries: VaultEntry[], expanded: Set<string>, level = 1, result: VisibleEntry[] = []) {
  entries.forEach((entry) => {
    result.push({ entry, level });
    if (entry.children?.length && expanded.has(entry.path)) {
      visibleEntries(entry.children, expanded, level + 1, result);
    }
  });
  return result;
}

/** Provides treeview focus, expansion, selection, and the core APG keyboard model. */
export default function VaultTree({ entries, selectedPath, onSelect, onOpen, onRename, onDelete }: VaultTreeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  const itemRefs = useMemo(() => new Map<string, HTMLDivElement>(), []);
  const visible = visibleEntries(entries, expanded);
  const activePath = visible.some(({ entry }) => entry.path === focusedPath)
    ? focusedPath
    : (visible[0]?.entry.path ?? null);

  useEffect(() => {
    if (activePath) itemRefs.get(activePath)?.focus();
  }, [activePath, itemRefs]);

  const focus = (path: string) => {
    setFocusedPath(path);
    itemRefs.get(path)?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>, entry: VaultEntry) => {
    const index = visible.findIndex(({ entry: item }) => item.path === entry.path);
    const isExpanded = expanded.has(entry.path);
    const parentIndex = entry.path.includes('/')
      ? visible.findIndex(({ entry: item }) => item.path === entry.path.slice(0, entry.path.lastIndexOf('/')))
      : -1;
    let target: string | undefined;
    switch (event.key) {
      case 'ArrowDown':
        target = visible[Math.min(index + 1, visible.length - 1)]?.entry.path;
        break;
      case 'ArrowUp':
        target = visible[Math.max(index - 1, 0)]?.entry.path;
        break;
      case 'Home':
        target = visible[0]?.entry.path;
        break;
      case 'End':
        target = visible.at(-1)?.entry.path;
        break;
      case 'ArrowRight':
        if (entry.children?.length && !isExpanded) {
          setExpanded((current) => new Set(current).add(entry.path));
        } else if (isExpanded) {
          target = visible[index + 1]?.entry.path;
        }
        break;
      case 'ArrowLeft':
        if (entry.children?.length && isExpanded) {
          setExpanded((current) => {
            const next = new Set(current);
            next.delete(entry.path);
            return next;
          });
        } else if (parentIndex >= 0) {
          target = visible[parentIndex].entry.path;
        }
        break;
      case 'Enter':
        onOpen(entry);
        break;
      case 'F2': {
        const name = window.prompt('Rename item', entry.name);
        if (name?.trim()) onRename(entry.path, name.trim());
        break;
      }
      case 'Delete':
        onDelete(entry.path);
        break;
      case '*':
        setExpanded((current) => {
          const next = new Set(current);
          const parent = entry.path.includes('/') ? entry.path.slice(0, entry.path.lastIndexOf('/')) : '';
          const siblings = parent
            ? (visible.find(({ entry: item }) => item.path === parent)?.entry.children ?? [])
            : entries;
          siblings.forEach((sibling) => {
            if (sibling.children?.length) next.add(sibling.path);
          });
          return next;
        });
        break;
      default:
        if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
          const query = event.key.toLocaleLowerCase();
          const candidate = [...visible.slice(index + 1), ...visible.slice(0, index + 1)].find(({ entry: item }) =>
            item.name.toLocaleLowerCase().startsWith(query),
          );
          target = candidate?.entry.path;
        } else {
          return;
        }
    }
    event.preventDefault();
    if (target) focus(target);
  };

  const render = (items: VaultEntry[], level = 1): ReactNode[] =>
    items.map((entry, index) => {
      const isExpanded = expanded.has(entry.path);
      return (
        <div key={entry.path}>
          <div
            ref={(element) => {
              if (element) itemRefs.set(entry.path, element);
              else itemRefs.delete(entry.path);
            }}
            role="treeitem"
            aria-expanded={entry.children?.length ? isExpanded : undefined}
            aria-level={level}
            aria-setsize={items.length}
            aria-posinset={index + 1}
            aria-selected={selectedPath === entry.path}
            tabIndex={activePath === entry.path ? 0 : -1}
            onFocus={() => {
              setFocusedPath(entry.path);
              onSelect(entry);
            }}
            onClick={() => {
              setFocusedPath(entry.path);
              onSelect(entry);
              if (entry.children?.length) {
                setExpanded((current) => {
                  const next = new Set(current);
                  if (next.has(entry.path)) next.delete(entry.path);
                  else next.add(entry.path);
                  return next;
                });
              } else onOpen(entry);
            }}
            onKeyDown={(event) => onKeyDown(event, entry)}
          >
            {entry.children?.length ? (isExpanded ? '▾ ' : '▸ ') : '　'}
            {entry.name}
            <span className="sr-only">, {entry.kind}</span>
          </div>
          {entry.children?.length && isExpanded ? <div role="group">{render(entry.children, level + 1)}</div> : null}
        </div>
      );
    });

  return (
    <div role="tree" aria-label="Vault files">
      {render(entries)}
      {!entries.length ? <p>No files yet. Create a notebook or note to get started.</p> : null}
    </div>
  );
}
