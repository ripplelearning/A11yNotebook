import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import NewFromTemplateDialog from '../renderer/features/templates/NewFromTemplateDialog';

afterEach(cleanup);

describe('new note from template dialog', () => {
  it('provides native selectors and a live read-only preview then creates expanded content', async () => {
    const onCreate = vi.fn();
    const onClose = vi.fn();
    render(
      <NewFromTemplateDialog
        notebooks={[{ path: 'Work', name: 'Work' }]}
        onCreate={onCreate}
        onClose={onClose}
        now={new Date(2026, 9, 3)}
      />,
    );
    expect(screen.getByRole('dialog', { name: 'New note from template' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Note title' })).toHaveFocus();
    fireEvent.change(screen.getByRole('combobox', { name: 'Template' }), { target: { value: 'meeting' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Note title' }), { target: { value: 'Planning' } });
    const preview = screen.getByRole('textbox', { name: 'Markdown preview' }) as HTMLTextAreaElement;
    expect(preview.readOnly).toBe(true);
    expect(preview.value).toContain('# Planning');
    expect(preview.value).not.toContain('{{cursor}}');
    fireEvent.click(screen.getByRole('button', { name: 'Create note' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onCreate).toHaveBeenCalledWith('Work/Planning.md', preview.value, expect.any(Number));
    expect(preview.value.slice(onCreate.mock.calls[0][2])).toMatch(/^\n\n## Agenda/);
  });

  it('rejects invalid titles and displays host filesystem errors without closing', async () => {
    const onClose = vi.fn();
    const onCreate = vi.fn().mockRejectedValue(new Error('A note with this name already exists.'));
    render(
      <NewFromTemplateDialog notebooks={[{ path: '', name: 'Vault root' }]} onCreate={onCreate} onClose={onClose} />,
    );
    fireEvent.change(screen.getByRole('textbox', { name: 'Note title' }), { target: { value: '../escape' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create note' }));
    expect(screen.getByRole('alert')).toHaveTextContent('path separators');
    expect(onCreate).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('textbox', { name: 'Note title' }), { target: { value: 'Valid.md' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create note' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('already exists'));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Create note' })).toBeEnabled();
  });

  it('includes user templates supplied by the host and permits Escape to cancel', () => {
    const onClose = vi.fn();
    render(
      <NewFromTemplateDialog
        notebooks={[{ path: 'Notes', name: 'Notes' }]}
        templates={[{ id: 'custom', name: 'Custom', content: '{{title}}{{cursor}} end' }]}
        onCreate={vi.fn()}
        onClose={onClose}
      />,
    );
    fireEvent.change(screen.getByRole('combobox', { name: 'Template' }), { target: { value: 'custom' } });
    expect(screen.getByRole('textbox', { name: 'Markdown preview' })).toHaveValue('Untitled end');
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Note title' }), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('disables creation when there are no notebooks', () => {
    render(<NewFromTemplateDialog notebooks={[]} onCreate={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Create note' })).toBeDisabled();
  });
});
