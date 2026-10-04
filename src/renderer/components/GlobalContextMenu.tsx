import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { CommandDefinition, CommandId } from '../../shared/command-registry';

interface Props {
  commands: CommandDefinition[];
  label: string;
  x: number;
  y: number;
  invoker: HTMLElement;
  disabled?: ReadonlySet<CommandId>;
  onClose: () => void;
  onSelect: (command: CommandId) => void;
}

export default function GlobalContextMenu({ commands, label, x, y, invoker, disabled, onClose, onSelect }: Props) {
  const menu = useRef<HTMLDivElement>(null);
  const typed = useRef('');
  const typeTimer = useRef<number | undefined>();
  const [position, setPosition] = useState({ x, y });
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const element = menu.current;
    const first = element?.querySelector<HTMLElement>('[role="menuitem"]');
    first?.focus();
    if (element) {
      const bounds = element.getBoundingClientRect();
      setPosition({
        x: Math.max(0, Math.min(x, window.innerWidth - bounds.width)),
        y: Math.max(0, Math.min(y, window.innerHeight - bounds.height)),
      });
    }
    return () => {
      window.clearTimeout(typeTimer.current);
      if (invoker.isConnected) invoker.focus();
    };
  }, [invoker, x, y]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
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
      setActiveIndex(next);
      items[next]?.focus();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    } else if (event.key === 'Tab') {
      event.preventDefault();
      onClose();
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const activeItem = items[index];
      if (activeItem?.getAttribute('aria-disabled') !== 'true') activeItem?.click();
    } else if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
      typed.current += event.key.toLocaleLowerCase();
      window.clearTimeout(typeTimer.current);
      typeTimer.current = window.setTimeout(() => {
        typed.current = '';
      }, 700);
      const start = Math.max(0, index + 1);
      const ordered = [...items.slice(start), ...items.slice(0, start)];
      const match = ordered.find((item) => item.textContent?.trim().toLocaleLowerCase().startsWith(typed.current));
      if (match) {
        const next = items.indexOf(match);
        setActiveIndex(next);
        match.focus();
      }
    }
    event.stopPropagation();
  };

  return (
    <div
      ref={menu}
      role="menu"
      aria-label={label}
      className="global-context-menu"
      style={{ left: position.x, top: position.y }}
      onKeyDown={onKeyDown}
      onBlur={(event) => {
        if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) onClose();
      }}
    >
      {commands.map((command, index) => {
        const isDisabled = disabled?.has(command.id) ?? false;
        return (
          <button
            key={command.id}
            type="button"
            role="menuitem"
            tabIndex={index === activeIndex ? 0 : -1}
            onFocus={() => setActiveIndex(index)}
            aria-disabled={isDisabled}
            onClick={() => {
              if (isDisabled) return;
              onSelect(command.id);
              onClose();
            }}
          >
            <span>{command.label}</span>
            {command.shortcut ? (
              <span className="context-menu-shortcut" aria-hidden="true">
                {command.shortcut}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
