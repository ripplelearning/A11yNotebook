import { useEffect, useRef, type KeyboardEvent } from 'react';
import type { VaultEntry } from '../../../shared/types';

export type TreeAction =
  'new-note' | 'new-template' | 'rename' | 'move' | 'delete' | 'reveal' | 'external' | 'bookmark';
const ACTIONS: { id: TreeAction; label: string }[] = [
  { id: 'new-note', label: 'New note' },
  { id: 'new-template', label: 'New from template' },
  { id: 'rename', label: 'Rename' },
  { id: 'move', label: 'Move' },
  { id: 'delete', label: 'Delete' },
  { id: 'reveal', label: 'Reveal in Explorer' },
  { id: 'external', label: 'Open in external app' },
  { id: 'bookmark', label: 'Bookmark' },
];

export default function TreeContextMenu({
  entry,
  onAction,
  onClose,
}: {
  entry: VaultEntry;
  onAction: (action: TreeAction) => void;
  onClose: () => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  const actions = ACTIONS.filter((action) => action.id !== 'bookmark' || entry.kind === 'note');
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? items.length - 1
            : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    } else if (event.key === 'Escape' || event.key === 'Tab') {
      if (event.key === 'Escape') event.preventDefault();
      onClose();
    }
    event.stopPropagation();
  };
  return (
    <div
      ref={menu}
      role="menu"
      aria-label={`Actions for ${entry.name}`}
      className="tree-context-menu"
      onKeyDown={keyDown}
      onBlur={(event) => {
        if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) onClose();
      }}
    >
      {actions.map((action) => (
        <button
          type="button"
          role="menuitem"
          key={action.id}
          onClick={() => {
            onClose();
            onAction(action.id);
          }}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}
