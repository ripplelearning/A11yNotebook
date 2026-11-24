import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SaveAsTemplateDialog from '../renderer/features/templates/SaveAsTemplateDialog';

afterEach(cleanup);

describe('save as template dialog', () => {
  it('prefills the note title, keeps the original by default, and saves a copy', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<SaveAsTemplateDialog initialName="Weekly review" existingNames={[]} onSave={onSave} onClose={onClose} />);
    expect(screen.getByRole('dialog', { name: 'Save note as template' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Template name' })).toHaveValue('Weekly review');
    expect(screen.getByRole('radio', { name: 'Keep the original note' })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Save as template' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onSave).toHaveBeenCalledWith({ name: 'Weekly review', action: 'copy', replace: false });
  });

  it('discards the original note when that option is chosen', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<SaveAsTemplateDialog initialName="Weekly review" existingNames={[]} onSave={onSave} onClose={onClose} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Discard the original note' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save as template' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onSave).toHaveBeenCalledWith({ name: 'Weekly review', action: 'discard', replace: false });
  });

  it('rejects invalid template names without saving', () => {
    const onSave = vi.fn();
    render(<SaveAsTemplateDialog initialName="Weekly review" existingNames={[]} onSave={onSave} onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Template name' }), {
      target: { value: '../escape' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save as template' }));
    expect(screen.getByRole('alert')).toHaveTextContent('path separators');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('asks before replacing an existing template and replaces only on confirmation', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(
      <SaveAsTemplateDialog
        initialName="Daily"
        existingNames={['Daily', 'Meeting']}
        onSave={onSave}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save as template' }));
    expect(screen.getByRole('alert')).toHaveTextContent('A template named “Daily” already exists.');
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Replace template' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onSave).toHaveBeenCalledWith({ name: 'Daily', action: 'copy', replace: true });
  });

  it('lets the user pick a different name instead of replacing', () => {
    const onSave = vi.fn();
    render(<SaveAsTemplateDialog initialName="Daily" existingNames={['Daily']} onSave={onSave} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save as template' }));
    expect(screen.getByRole('alert')).toHaveTextContent('already exists');
    fireEvent.click(screen.getByRole('button', { name: 'Choose a different name' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Template name' }), {
      target: { value: 'Daily notes' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save as template' }));
    expect(onSave).toHaveBeenCalledWith({ name: 'Daily notes', action: 'copy', replace: false });
  });

  it('shows host save errors without closing and permits Escape to cancel', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('Could not save the template.'));
    const onClose = vi.fn();
    render(<SaveAsTemplateDialog initialName="Weekly review" existingNames={[]} onSave={onSave} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save as template' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Could not save the template.'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Template name' }), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
