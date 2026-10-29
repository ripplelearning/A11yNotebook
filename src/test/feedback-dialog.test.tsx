import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FeedbackDialog } from '../renderer/components/HelpDialogs';

describe('Feedback dialog', () => {
  const fetchMock = vi.fn();
  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  function renderDialog() {
    vi.stubGlobal('fetch', fetchMock);
    return render(<FeedbackDialog onClose={vi.fn()} announce={vi.fn()} />);
  }

  it('requires a message before sending', async () => {
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a message before sending.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the message with project identification and reply-to, then confirms', async () => {
    fetchMock.mockResolvedValue({ ok: true });
    const announce = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<FeedbackDialog onClose={vi.fn()} announce={announce} />);
    fireEvent.change(screen.getByLabelText('Message (required)'), { target: { value: 'The tour helped.' } });
    fireEvent.change(screen.getByLabelText('Name (optional)'), { target: { value: 'Tester' } });
    fireEvent.change(screen.getByLabelText('Email (optional)'), { target: { value: 'tester@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, options] = fetchMock.mock.calls[0] as [string, { body: string }];
    const body = JSON.parse(options.body) as Record<string, unknown>;
    expect(body.subject).toBe('A11y Notebook feedback');
    expect(body.from_name).toBe('A11y Notebook');
    expect(body.project).toBe('A11y Notebook');
    expect(body.message).toBe('The tour helped.');
    expect(body.replyto).toBe('tester@example.com');
    expect(await screen.findByText('Thank you. Your feedback was sent.')).toBeInTheDocument();
    expect(announce).toHaveBeenCalledWith('Thank you. Your feedback was sent.');
  });

  it('never sends when the honeypot field is filled', async () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText('Message (required)'), { target: { value: 'Spam?' } });
    fireEvent.change(screen.getByLabelText('Website'), { target: { value: 'http://spam.example' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('Thank you. Your feedback was sent.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps the message and reports failure when sending fails', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    renderDialog();
    fireEvent.change(screen.getByLabelText('Message (required)'), { target: { value: 'Please keep me.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Feedback could not be sent.');
    expect(screen.getByLabelText('Message (required)')).toHaveValue('Please keep me.');
  });
});
