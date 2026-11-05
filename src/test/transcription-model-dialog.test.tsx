import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TranscriptionModelDialog } from '../renderer/features/audio/TranscriptionModelDialog';

describe('TranscriptionModelDialog', () => {
  it('shows both models with their sizes and differences', () => {
    render(<TranscriptionModelDialog onDownload={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'Choose a transcription model' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Smaller model — About 150 MB/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Larger model — About 500 MB/ })).toBeInTheDocument();
    expect(screen.getByText(/runs on your machine, so your audio never leaves it/)).toBeInTheDocument();
  });

  it('preselects the smaller model and downloads it by default', () => {
    const onDownload = vi.fn();
    render(<TranscriptionModelDialog onDownload={onDownload} onCancel={vi.fn()} />);
    expect(screen.getByRole('radio', { name: /Smaller model/ })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Download model' }));
    expect(onDownload).toHaveBeenCalledWith('smaller');
  });

  it('downloads the larger model when it is chosen', () => {
    const onDownload = vi.fn();
    render(<TranscriptionModelDialog onDownload={onDownload} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole('radio', { name: /Larger model/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Download model' }));
    expect(onDownload).toHaveBeenCalledWith('larger');
  });

  it('cancels without downloading', () => {
    const onCancel = vi.fn();
    const onDownload = vi.fn();
    render(<TranscriptionModelDialog onDownload={onDownload} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onDownload).not.toHaveBeenCalled();
  });
});
