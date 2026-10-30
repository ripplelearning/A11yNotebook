// Batch 5: with no library to reopen, startup lands on the Libraries
// picker (keyboard-reachable, announced) instead of Notes and Files.
import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../renderer/App';
import type { NotebookBridge } from '../shared/bridge';
import { vaultExtensions } from './vault-extensions';

afterEach(() => {
  delete window.a11yNotebook;
  window.localStorage.clear();
});

describe('startup with no library', () => {
  it('lands on the Libraries picker', async () => {
    const bridge = {
      updater: {
        check: vi.fn(async () => undefined),
        download: vi.fn(async () => undefined),
        installNow: vi.fn(async () => undefined),
        installOnExit: vi.fn(async () => undefined),
        onStatus: vi.fn(() => () => undefined),
      },
      vault: {
        ...vaultExtensions(),
        get: vi.fn(async () => null),
        getSecurityStatus: vi.fn(async () => ({ enabled: false, locked: false, recoveryAvailable: false })),
        getTasks: vi.fn(async () => []),
        getLinkIndex: vi.fn(async () => ({ links: [] })),
        getBookmarks: vi.fn(async () => []),
        isNoteEncrypted: vi.fn(async () => false),
        onSecurityLocked: vi.fn(() => () => undefined),
        getRecentLibraries: vi.fn(async () => []),
      },
      onMenuCommand: vi.fn(() => () => undefined),
    } as unknown as NotebookBridge;
    window.a11yNotebook = bridge;
    window.localStorage.setItem('a11y-notebook.tutorial', JSON.stringify({ suppressed: true, lastVersionSeen: '' }));
    render(<App />);
    expect(await screen.findByRole('grid', { name: 'Libraries' })).toBeInTheDocument();
    const panel = screen.getByRole('tabpanel');
    expect(within(panel).getByRole('button', { name: 'New library' })).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Open library' })).toBeInTheDocument();
  });
});
