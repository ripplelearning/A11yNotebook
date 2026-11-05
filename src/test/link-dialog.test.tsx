import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LinkDialog } from '../renderer/features/links/LinkDialog';

function renderAddLink(props: Partial<React.ComponentProps<typeof LinkDialog>> = {}) {
  const onSubmit = vi.fn(async () => undefined);
  const onClose = vi.fn();
  render(
    <LinkDialog
      title="Add link"
      initialTitle=""
      initialUrl=""
      submitLabel="Add link"
      onSubmit={onSubmit}
      onClose={onClose}
      {...props}
    />,
  );
  return { onSubmit, onClose };
}

describe('LinkDialog', () => {
  it('shows title and web address fields', () => {
    renderAddLink();
    expect(screen.getByRole('dialog', { name: 'Add link' })).toBeInTheDocument();
    expect(screen.getByLabelText('Title')).toBeInTheDocument();
    expect(screen.getByLabelText('Web address')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add link' })).toBeInTheDocument();
  });

  it('shows the import guidance above the form when provided', () => {
    renderAddLink({
      initialUrl: 'https://docs.google.com/document/d/abc/edit',
      guidance: 'A Google Docs (.gdoc) file is only a link to an online document.',
    });
    expect(screen.getByText(/only a link to an online document/)).toBeInTheDocument();
    expect(screen.getByLabelText('Web address')).toHaveValue('https://docs.google.com/document/d/abc/edit');
  });

  it('requires a title', () => {
    const { onSubmit } = renderAddLink();
    fireEvent.change(screen.getByLabelText('Web address'), { target: { value: 'https://example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add link' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a link title.');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('requires a web address with an allowed scheme', () => {
    const { onSubmit } = renderAddLink();
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Example Site' } });
    fireEvent.change(screen.getByLabelText('Web address'), { target: { value: 'ftp://example.com/file' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add link' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a web address starting with http://, https://, or mailto:.');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits the trimmed title and address', async () => {
    const { onSubmit, onClose } = renderAddLink();
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: '  Example Site  ' } });
    fireEvent.change(screen.getByLabelText('Web address'), { target: { value: 'https://example.com/guide' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add link' }));
    expect(onSubmit).toHaveBeenCalledWith('Example Site', 'https://example.com/guide');
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('prefills the title and address when editing', () => {
    renderAddLink({
      title: 'Edit link',
      initialTitle: 'Example Site',
      initialUrl: 'https://example.com/guide',
      submitLabel: 'Save changes',
    });
    expect(screen.getByLabelText('Title')).toHaveValue('Example Site');
    expect(screen.getByLabelText('Web address')).toHaveValue('https://example.com/guide');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument();
  });

  it('cancels without submitting', () => {
    const { onSubmit, onClose } = renderAddLink();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
