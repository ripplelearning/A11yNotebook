import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../renderer/App';
import type { NotebookBridge } from '../shared/bridge';
import type { MenuCommand } from '../shared/ipc';
import type { VaultInfo } from '../shared/types';
import { DEFAULT_SETTINGS } from '../shared/settings';
import { vaultExtensions } from './vault-extensions';

const NOTE_CONTENT = '# Idea\n\nSome text to dictate into.\n';

/** Stand-in for the browser's MediaRecorder: the app drives it through the same calls. */
class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = [];
  static isTypeSupported = () => true;
  readonly mimeType = 'audio/webm';
  state: 'inactive' | 'recording' | 'paused' = 'inactive';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((event: { error?: { message?: string } }) => void) | null = null;
  pauseCalls = 0;
  resumeCalls = 0;
  stopCalls = 0;

  constructor() {
    FakeMediaRecorder.instances.push(this);
  }

  start() {
    this.state = 'recording';
  }

  stop() {
    this.stopCalls += 1;
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['audio'], { type: 'audio/webm' }) });
    this.onstop?.();
  }

  pause() {
    this.state = 'paused';
    this.pauseCalls += 1;
  }

  resume() {
    this.state = 'recording';
    this.resumeCalls += 1;
  }
}

let mediaDevicesDescriptor: PropertyDescriptor | undefined;

function installBridge(getUserMedia: (constraints: { audio: boolean }) => Promise<unknown>) {
  const vault: VaultInfo = {
    name: 'Study',
    path: '/study',
    entries: [{ name: 'Idea.md', path: 'Idea.md', kind: 'note', provenance: 'created' }],
  };
  const bridge = {
    vault: {
      ...vaultExtensions(),
      open: vi.fn(async () => vault),
      get: vi.fn(async () => vault),
      readNote: vi.fn(async () => NOTE_CONTENT),
      saveNote: vi.fn(async () => undefined),
      getTasks: vi.fn(async () => []),
      getLinkIndex: vi.fn(async () => ({ links: [] })),
      getBookmarks: vi.fn(async () => []),
      getSettings: vi.fn(async () => ({
        ...DEFAULT_SETTINGS,
        autosaveDelay: 0,
        showCommandButtons: true,
        transcriptionModel: 'smaller',
      })),
    },
    updater: {
      check: vi.fn(),
      download: vi.fn(),
      installNow: vi.fn(),
      onStatus: vi.fn(() => () => undefined),
    },
    setShortcutCaptureActive: vi.fn(),
    onMenuCommand: (callback: (command: MenuCommand) => void) => {
      return () => {
        void callback;
      };
    },
  };
  window.a11yNotebook = bridge as unknown as NotebookBridge;
  mediaDevicesDescriptor = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia },
    configurable: true,
  });
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
}

afterEach(() => {
  cleanup();
  delete window.a11yNotebook;
  vi.unstubAllGlobals();
  if (mediaDevicesDescriptor) {
    Object.defineProperty(navigator, 'mediaDevices', mediaDevicesDescriptor);
  } else {
    delete (navigator as unknown as Record<string, unknown>).mediaDevices;
  }
  mediaDevicesDescriptor = undefined;
  FakeMediaRecorder.instances = [];
});

async function openNoteInEditMode(): Promise<HTMLTextAreaElement> {
  await screen.findByRole('heading', { name: 'Study' });
  fireEvent.keyDown(document.body, { key: 'V', ctrlKey: true, shiftKey: true });
  fireEvent.click(await screen.findByRole('treeitem', { name: /Idea\.md/ }));
  await screen.findByRole('heading', { name: 'Idea', level: 2 });
  fireEvent.keyDown(document.body, { key: 'e', ctrlKey: true });
  return (await screen.findByRole('textbox', { name: 'Markdown source' })) as HTMLTextAreaElement;
}

async function startDictation(): Promise<FakeMediaRecorder> {
  fireEvent.click(screen.getByRole('button', { name: 'Dictate' }));
  await screen.findByRole('button', { name: 'Stop dictation' });
  expect(FakeMediaRecorder.instances).toHaveLength(1);
  const recorder = FakeMediaRecorder.instances[0];
  expect(recorder.state).toBe('recording');
  return recorder;
}

/**
 * The status message renders twice (footer status bar and the right
 * pane's "Last action"), so assert on the footer copy — the one a
 * screen reader announces from the live region.
 */
async function expectStatus(text: string): Promise<void> {
  const bar = screen.getByRole('contentinfo', { name: 'Status bar' });
  expect(await within(bar).findByText(text)).toBeInTheDocument();
}

describe('dictation microphone', () => {
  it('shows the blocked-microphone dialog on denial, and Retry tries the microphone again', async () => {
    const getUserMedia = vi.fn(async () => {
      throw new DOMException('Permission denied', 'NotAllowedError');
    });
    installBridge(getUserMedia);
    render(<App />);
    await openNoteInEditMode();

    fireEvent.click(screen.getByRole('button', { name: 'Dictate' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Microphone is blocked' });
    expect(within(dialog).getByText(/cannot use the microphone/)).toBeInTheDocument();
    expect(getUserMedia).toHaveBeenCalledTimes(1);

    // Retry tries the microphone again without asking for the model again.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Retry' }));
    await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
    const dialogAgain = await screen.findByRole('alertdialog', { name: 'Microphone is blocked' });

    fireEvent.click(within(dialogAgain).getByRole('button', { name: 'Cancel' }));
    await vi.waitFor(() =>
      expect(screen.queryByRole('alertdialog', { name: 'Microphone is blocked' })).not.toBeInTheDocument(),
    );
    await expectStatus('Dictation is off. The microphone is blocked.');

    // Alt+Ctrl+D again retries too: the model is already chosen, so no
    // model dialog appears — the blocked dialog comes straight back.
    fireEvent.keyDown(window, { key: 'd', ctrlKey: true, altKey: true });
    expect(await screen.findByRole('alertdialog', { name: 'Microphone is blocked' })).toBeInTheDocument();
    expect(getUserMedia).toHaveBeenCalledTimes(3);
  });

  it('F9 mutes and unmutes the microphone during dictation without ending the session', async () => {
    const tracks = [{ stop: vi.fn() }];
    installBridge(vi.fn(async () => ({ getTracks: () => tracks })));
    render(<App />);
    await openNoteInEditMode();

    const recorder = await startDictation();
    await expectStatus('Dictating. Press Ctrl+Alt+D again to stop, or F9 to turn the microphone off.');

    fireEvent.keyDown(window, { key: 'F9' });
    await expectStatus('Microphone off.');
    expect(recorder.state).toBe('paused');
    expect(recorder.pauseCalls).toBe(1);

    fireEvent.keyDown(window, { key: 'F9' });
    await expectStatus('Microphone on.');
    expect(recorder.state).toBe('recording');
    expect(recorder.resumeCalls).toBe(1);

    // The session is still active: F9 never ends it.
    expect(screen.getByRole('button', { name: 'Stop dictation' })).toBeInTheDocument();
  });

  it('F9 outside dictation does nothing: the pane stays open and the microphone stays untouched', async () => {
    const getUserMedia = vi.fn(async () => ({ getTracks: () => [] }));
    installBridge(getUserMedia);
    render(<App />);
    await screen.findByRole('heading', { name: 'Study' });

    // F9 is the microphone toggle now: outside dictation it must stay
    // silent — no announcement, no pane change, no microphone use.
    expect(screen.getByRole('complementary', { name: 'Right information pane' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'F9' });
    expect(screen.getByRole('complementary', { name: 'Right information pane' })).toBeInTheDocument();
    expect(screen.queryByText('Right pane closed.')).not.toBeInTheDocument();
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('F8 toggles the right pane and F9 no longer does', async () => {
    const getUserMedia = vi.fn(async () => ({ getTracks: () => [] }));
    installBridge(getUserMedia);
    render(<App />);
    await screen.findByRole('heading', { name: 'Study' });

    fireEvent.keyDown(window, { key: 'F8' });
    await expectStatus('Right pane closed.');
    expect(screen.queryByRole('complementary', { name: 'Right information pane' })).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'F8' });
    await expectStatus('Right pane opened.');
    expect(screen.getByRole('complementary', { name: 'Right information pane' })).toBeInTheDocument();

    // F9 used to own this job; now it leaves the pane alone.
    fireEvent.keyDown(window, { key: 'F9' });
    expect(screen.getByRole('complementary', { name: 'Right information pane' })).toBeInTheDocument();
    expect(screen.queryByText('Right pane closed.')).not.toBeInTheDocument();
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('ends the session and drops the recording when focus leaves the note text field', async () => {
    const tracks = [{ stop: vi.fn() }];
    installBridge(vi.fn(async () => ({ getTracks: () => tracks })));
    render(<App />);
    await openNoteInEditMode();

    const recorder = await startDictation();
    // Focus moves out of the note's text field to the status bar — the
    // F6 region target — which ends the session.
    (screen.getByRole('contentinfo', { name: 'Status bar' }) as HTMLElement).focus();

    await expectStatus('Dictation stopped. You left the note, so the recording was not saved.');
    expect(recorder.stopCalls).toBe(1);
    expect(tracks[0].stop).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Dictate' })).toBeInTheDocument();
  });

  it('ends the session and drops the recording when the note is closed', async () => {
    const tracks = [{ stop: vi.fn() }];
    installBridge(vi.fn(async () => ({ getTracks: () => tracks })));
    render(<App />);
    await openNoteInEditMode();

    const recorder = await startDictation();
    fireEvent.keyDown(window, { key: 'w', ctrlKey: true });

    await expectStatus('Dictation stopped. The note was closed, so the recording was not saved.');
    expect(recorder.stopCalls).toBe(1);
    expect(tracks[0].stop).toHaveBeenCalled();
  });
});
