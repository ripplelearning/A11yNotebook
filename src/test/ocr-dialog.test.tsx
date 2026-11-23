import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OcrDialog from '../renderer/features/previews/OcrDialog';
import type { OcrEngine, OcrEngineLogger } from '../renderer/features/previews/ocr-engine';
import type { OcrRunUnit } from '../renderer/features/previews/ocr-runner';
import type { NotebookBridge } from '../shared/bridge';

function fakeEngineFactory(options: {
  text?: string;
  recognize?: OcrEngine['recognize'];
  onCreate?: (language: string) => void;
} = {}): (language: string, onLogger: OcrEngineLogger) => Promise<OcrEngine> {
  return async (language) => {
    options.onCreate?.(language);
    return {
      recognize:
        options.recognize ??
        (async () => ({ text: options.text ?? 'HELLO', words: [] })),
      terminate: vi.fn(async () => undefined),
    };
  };
}

function twoUnits(): OcrRunUnit[] {
  return [
    { index: 0, loadImages: async () => ['image-0'] },
    { index: 1, loadImages: async () => ['image-1'] },
  ];
}

function renderDialog(overrides: Partial<Parameters<typeof OcrDialog>[0]> = {}) {
  const onClose = vi.fn();
  const onComplete = vi.fn();
  const onSaveNow = vi.fn(async () => undefined);
  const prepareUnits = vi.fn(async () => twoUnits());
  const props = {
    kind: '.pdf' as const,
    total: 2,
    isAlius: false,
    onClose,
    onComplete,
    onSaveNow,
    prepareUnits,
    createEngine: fakeEngineFactory(),
    ...overrides,
  };
  const result = render(<OcrDialog {...props} />);
  return { ...result, props, onClose, onComplete, onSaveNow, prepareUnits };
}

describe('OCR dialog', () => {
  beforeEach(() => {
    window.a11yNotebook = {
      vault: {
        listOcrLanguages: vi.fn(async () => [
          { code: 'eng', name: 'English', ready: true },
          { code: 'spa', name: 'Spanish', ready: false },
        ]),
        ensureOcrLanguage: vi.fn(async () => ({ ready: true, downloaded: true })),
      },
    } as unknown as NotebookBridge;
  });

  afterEach(() => {
    delete window.a11yNotebook;
    vi.restoreAllMocks();
  });

  it('asks for a language every time: Start stays disabled until one is picked', async () => {
    renderDialog();
    await waitFor(() => expect(screen.getByRole('radio', { name: /English/ })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Start OCR' })).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: /English/ }));
    expect(screen.getByRole('button', { name: 'Start OCR' })).not.toBeDisabled();
    // No language is preselected.
    expect(screen.getByRole('radio', { name: /Spanish/ })).not.toBeChecked();
  });

  it('announces itself on open: focus moves inside the dialog and the opening message is its accessible description', async () => {
    // Regression: the Start button carries data-autofocus but is disabled
    // until a language is picked, so focus used to stay outside the dialog
    // and the message "silently appeared" — never announced.
    renderDialog({ kind: '.epub', total: 23 });
    await waitFor(() => expect(screen.getByRole('radio', { name: /English/ })).toBeInTheDocument());
    const dialog = screen.getByRole('dialog', {
      name: 'OCR this file',
      description:
        /OCR runs entirely on this computer\. Nothing is uploaded\. It reads the whole file — 23 sections have no extractable text — and can take a few minutes for a long file\./,
    });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    expect(document.activeElement).not.toBe(screen.getByRole('button', { name: 'Start OCR' }));
  });

  it('closes on Escape and returns focus to the element that opened it', async () => {
    const opener = document.createElement('button');
    opener.textContent = 'OCR this file';
    document.body.appendChild(opener);
    opener.focus();
    const { onClose } = renderDialog();
    await waitFor(() => expect(screen.getByRole('radio', { name: /English/ })).toBeInTheDocument());
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'OCR this file' }), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    document.body.removeChild(opener);
  });

  it('runs the whole file and hands the results to the reader', async () => {
    const { onComplete } = renderDialog();
    await waitFor(() => expect(screen.getByRole('radio', { name: /English/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('radio', { name: /English/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Start OCR' }));
    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    const results = onComplete.mock.calls[0][0] as Map<number, { text: string }>;
    expect(results.size).toBe(2);
    expect(results.get(0)?.text).toBe('HELLO');
    expect(screen.getByRole('status')).toHaveTextContent(/OCR finished\. Recognized text for 2 of 2 pages\./);
    expect(screen.getByRole('button', { name: 'Save into file' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep temporary in reader' })).toBeInTheDocument();
  });

  it('shows progress and lets the run be cancelled', async () => {
    let release = () => {};
    const held = new Promise<{ text: string; words: [] }>((resolve) => {
      release = () => resolve({ text: 'HELLO', words: [] });
    });
    const { onComplete } = renderDialog({
      createEngine: fakeEngineFactory({ recognize: () => held }),
    });
    await waitFor(() => expect(screen.getByRole('radio', { name: /English/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('radio', { name: /English/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Start OCR' }));
    await waitFor(() => expect(screen.getByRole('progressbar', { name: 'OCR progress' })).toBeInTheDocument());
    expect(screen.getByRole('status')).toHaveTextContent('Recognizing 1 of 2.');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel OCR' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('OCR cancelled. No text was saved.'));
    expect(onComplete).not.toHaveBeenCalled();
    release();
  });

  it('saves from the dialog and then closes', async () => {
    const { onComplete, onSaveNow, onClose } = renderDialog();
    await waitFor(() => expect(screen.getByRole('radio', { name: /English/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('radio', { name: /English/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Start OCR' }));
    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Save into file' }));
    await waitFor(() => expect(onSaveNow).toHaveBeenCalled());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('downloads a missing language once, saying so, before recognizing', async () => {
    const vault = window.a11yNotebook!.vault;
    const onCreate = vi.fn();
    const { onComplete } = renderDialog({ createEngine: fakeEngineFactory({ onCreate }) });
    await waitFor(() => expect(screen.getByRole('radio', { name: /Spanish/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('radio', { name: /Spanish/ }));
    expect(screen.getByText(/language data is not on this computer yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Start OCR' }));
    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    expect(vault.ensureOcrLanguage).toHaveBeenCalledWith('spa');
    expect(onCreate).toHaveBeenCalledWith('spa');
  });

  it('reports an engine failure instead of hanging', async () => {
    const { onComplete } = renderDialog({
      createEngine: async () => {
        throw new Error('The OCR engine could not start.');
      },
    });
    await waitFor(() => expect(screen.getByRole('radio', { name: /English/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('radio', { name: /English/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Start OCR' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('The OCR engine could not start.'));
    expect(onComplete).not.toHaveBeenCalled();
  });
});
