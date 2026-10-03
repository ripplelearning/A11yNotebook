import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useAnnotations, type UseAnnotationsOptions } from '../renderer/features/annotations/useAnnotations';
import MarkdownDocument from '../renderer/features/vault/MarkdownDocument';
import type { NoteAnnotation } from '../shared/annotations';

function Harness(props: Partial<UseAnnotationsOptions>) {
  const mode = props.enabled === false ? 'edit' : 'read-only';
  const annotations = useAnnotations({
    path: 'Note.md', content: 'One **bold** phrase.', enabled: true, annotations: [],
    onAdd: vi.fn(async () => undefined), onUpdate: vi.fn(async () => undefined), onDelete: vi.fn(async () => undefined),
    ...props,
  });
  return <><button type="button" onClick={annotations.begin}>Host annotate</button>{annotations.toolbar}<div ref={annotations.documentRef}>
    <MarkdownDocument content={props.content ?? 'One **bold** phrase.'} mode={mode} links={[]} onChange={vi.fn()} onNavigate={vi.fn()} />
  </div><aside>{annotations.pane}</aside></>;
}

function selectBold() {
  const range = document.createRange();
  range.selectNodeContents(screen.getByText('bold'));
  const selection = document.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
}

const annotation: NoteAnnotation = {
  id: 'test-id', path: 'Note.md', color: 'blue', label: 'Review', comment: 'Check it',
  anchor: { quote: 'bold', prefix: 'One ', suffix: ' phrase.', start: 4, end: 8 },
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('annotation reading UI', () => {
  it('opens a labelled keyboard-accessible dialog with shortcut and saves captured selection', async () => {
    const onAdd = vi.fn(async () => undefined);
    render(<Harness onAdd={onAdd} />);
    selectBold();
    fireEvent.keyDown(document, { key: 'A', ctrlKey: true, shiftKey: true });
    expect(screen.getByRole('dialog', { name: 'Add annotation' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Highlight label' })).toHaveFocus();
    fireEvent.change(screen.getByRole('textbox', { name: 'Highlight label' }), { target: { value: 'Question' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Comment' }), { target: { value: '<script>literal</script>' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save annotation' }));
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith({
      path: 'Note.md', anchor: { ...annotation.anchor, suffix: ' phrase.\n' }, color: 'yellow', label: 'Question', comment: '<script>literal</script>',
    }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('supports the selection button and keeps a failed save editable', async () => {
    render(<Harness onAdd={vi.fn(async () => { throw new Error('disk'); })} />);
    selectBold();
    fireEvent.click(screen.getByRole('button', { name: 'Annotate selection' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save annotation' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save');
    expect(screen.getByRole('button', { name: 'Save annotation' })).toBeEnabled();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('lists annotations, jumps with focus, edits and deletes through host callbacks', async () => {
    const onUpdate = vi.fn(async () => undefined);
    const onDelete = vi.fn(async () => undefined);
    const { container } = render(<Harness annotations={[annotation]} onUpdate={onUpdate} onDelete={onDelete} />);
    expect(screen.getByRole('region', { name: 'Annotations' })).toHaveTextContent('blue highlight');
    fireEvent.click(screen.getByRole('button', { name: 'Jump to annotation: Review' }));
    expect(container.querySelector('mark')).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Edit annotation: Review' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Comment' }), { target: { value: 'New comment' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save annotation' }));
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith('test-id', { color: 'blue', label: 'Review', comment: 'New comment' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Delete annotation: Review' }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith('test-id'));
  });

  it('reanchors after content changes and reports unavailable highlights without guessing', () => {
    const { container, rerender } = render(<Harness annotations={[annotation]} />);
    rerender(<Harness annotations={[annotation]} content="Inserted. One **bold** phrase." />);
    expect(container.querySelector('mark')).toHaveTextContent('bold');
    rerender(<Harness annotations={[annotation]} content="One bold phrase. One bold phrase." />);
    expect(container.querySelector('mark')).toBeNull();
    expect(screen.getByRole('button', { name: 'Jump to annotation: Review' })).toBeDisabled();
    expect(screen.getByRole('region', { name: 'Annotations' })).toHaveTextContent('ambiguous');
  });

  it('disables selection annotation and removes marks in edit mode', () => {
    const { container, rerender } = render(<Harness annotations={[annotation]} />);
    rerender(<Harness enabled={false} annotations={[annotation]} />);
    expect(screen.getByRole('button', { name: 'Annotate selection' })).toBeDisabled();
    expect(container.querySelector('mark')).toBeNull();
    fireEvent.keyDown(document, { key: 'A', ctrlKey: true, shiftKey: true });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('lets the host own shortcuts and announces through the existing app status region', async () => {
    const announce = vi.fn();
    render(<Harness bindShortcut={false} announce={announce} />);
    selectBold();
    fireEvent.keyDown(document, { key: 'A', ctrlKey: true, shiftKey: true });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Host annotate' }));
    expect(screen.getByRole('dialog', { name: 'Add annotation' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save annotation' }));
    await waitFor(() => expect(announce).toHaveBeenCalledWith('Annotation saved.'));
  });

  it('does not intercept the annotation shortcut while another dialog is open', () => {
    render(<Harness />);
    selectBold();
    const otherDialog = document.createElement('div');
    otherDialog.setAttribute('role', 'dialog');
    document.body.append(otherDialog);
    fireEvent.keyDown(document, { key: 'A', ctrlKey: true, shiftKey: true });
    expect(screen.queryByRole('dialog', { name: 'Add annotation' })).not.toBeInTheDocument();
    otherDialog.remove();
  });
});
