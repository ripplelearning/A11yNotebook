import { fireEvent, render, screen, within } from '@testing-library/react';
import { useEffect, useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import GlobalContextMenu from '../renderer/components/GlobalContextMenu';
import { getContextMenuCommands } from '../shared/command-registry';

function MenuHarness({ onSelect }: { onSelect: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const invoker = useRef<HTMLButtonElement>(null);
  useEffect(() => setOpen(true), []);
  return (
    <>
      <button ref={invoker} id="invoker">
        Open actions
      </button>
      {open && invoker.current ? (
        <GlobalContextMenu
          commands={getContextMenuCommands('tree-note')}
          label="Actions for Note.md"
          x={20}
          y={30}
          invoker={invoker.current}
          disabled={new Set(['context-encrypt-note'])}
          onClose={() => setOpen(false)}
          onSelect={onSelect}
        />
      ) : null}
    </>
  );
}

describe('global context menu', () => {
  it('supports arrow navigation, Home/End, type-ahead, disabled items, and Escape focus return', () => {
    const onSelect = vi.fn();
    render(<MenuHarness onSelect={onSelect} />);
    const menu = screen.getByRole('menu', { name: 'Actions for Note.md' });
    const items = within(menu).getAllByRole('menuitem');
    expect(items[0]).toHaveFocus();
    fireEvent.keyDown(items[0], { key: 'ArrowDown' });
    expect(items[1]).toHaveFocus();
    fireEvent.keyDown(items[1], { key: 'End' });
    expect(items.at(-1)).toHaveFocus();
    fireEvent.keyDown(items.at(-1)!, { key: 'Home' });
    expect(items[0]).toHaveFocus();
    fireEvent.keyDown(items[0], { key: 'r' });
    fireEvent.keyDown(document.activeElement!, { key: 'e' });
    fireEvent.keyDown(document.activeElement!, { key: 'v' });
    expect(within(menu).getByRole('menuitem', { name: 'Reveal in Explorer' })).toHaveFocus();

    const disabled = within(menu).getByRole('menuitem', { name: 'Encrypt note' });
    expect(disabled).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(disabled);
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open actions' })).toHaveFocus();
  });

  it.each(['Enter', ' '])('activates the focused command with %s and returns focus', (key) => {
    const onSelect = vi.fn();
    render(<MenuHarness onSelect={onSelect} />);
    const menu = screen.getByRole('menu', { name: 'Actions for Note.md' });
    const first = within(menu).getByRole('menuitem', { name: 'Open' });
    fireEvent.keyDown(first, { key });
    expect(onSelect).toHaveBeenCalledWith('context-open');
    expect(screen.getByRole('button', { name: 'Open actions' })).toHaveFocus();
  });
});
