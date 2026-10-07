// @vitest-environment node
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '../shared/ipc';

const mock = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(),
  quit: [] as (() => void)[],
  root: '',
  userData: '',
  confirm: 1,
  failIndexRefreshAt: 0,
  refreshCount: 0,
  failReminderWrite: false,
  partialRepairWrite: false,
  failRecentWrite: false,
  delayCredentialWrites: false,
  captureTitle: '.Research',
  notificationsSupported: false,
  notifications: [] as { emit: (event: string) => void }[],
  reminderEvents: [] as unknown[],
  protocol: undefined as undefined | ((request: { url: string }) => Promise<Response>),
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    writeFile: async (...args: Parameters<typeof actual.writeFile>) => {
      if (mock.failRecentWrite && String(args[0]).endsWith('recent-vault.json'))
        throw new Error('Recent-vault persistence failed.');
      if (mock.partialRepairWrite && path.basename(String(args[0])).includes('Reference.md')) {
        mock.partialRepairWrite = false;
        await actual.writeFile(args[0], String(args[1]).slice(0, 4), args[2]);
        throw Object.assign(new Error('Partial write: disk full.'), { code: 'ENOSPC' });
      }
      return actual.writeFile(...args);
    },
  };
});

vi.mock('electron', () => ({
  app: { getPath: () => mock.userData, on: (_name: string, callback: () => void) => mock.quit.push(callback) },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => Promise<unknown>) => mock.handlers.set(channel, handler),
  },
  dialog: {
    showOpenDialog: async () => ({ canceled: false, filePaths: [mock.root] }),
    showMessageBox: async () => ({ response: mock.confirm }),
  },
  protocol: {
    handle: (_scheme: string, handler: (request: { url: string }) => Promise<Response>) => {
      mock.protocol = handler;
    },
  },
  Notification: class {
    private listeners = new Map<string, () => void>();
    constructor() {
      mock.notifications.push(this);
    }
    on(event: string, callback: () => void) {
      this.listeners.set(event, callback);
    }
    show() {}
    close() {
      this.emit('close');
    }
    emit(event: string) {
      this.listeners.get(event)?.();
    }
    static isSupported() {
      return mock.notificationsSupported;
    }
  },
  shell: { showItemInFolder: vi.fn(), openPath: vi.fn(async () => ''), trashItem: vi.fn(async () => undefined) },
}));

vi.mock('../../electron/vault/search', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../electron/vault/search')>();
  return {
    ...actual,
    createSearchIndex: (...args: Parameters<typeof actual.createSearchIndex>) => {
      const index = actual.createSearchIndex(...args);
      return {
        ...index,
        refresh: async () => {
          mock.refreshCount += 1;
          if (mock.refreshCount === mock.failIndexRefreshAt) throw new Error('Index write failed after disk mutation.');
          return index.refresh();
        },
      };
    },
  };
});

vi.mock('../../electron/vault/metadata', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../electron/vault/metadata')>();
  return {
    ...actual,
    createMetadataStore: (...args: Parameters<typeof actual.createMetadataStore>) => {
      const store = actual.createMetadataStore(...args);
      return {
        ...store,
        write: async (name: string, value: unknown) => {
          if (name === 'reminders.json' && mock.failReminderWrite) {
            mock.failReminderWrite = false;
            throw new Error('Reminder migration failed.');
          }
          if (name === 'credentials.json' && mock.delayCredentialWrites)
            await new Promise((resolve) => setTimeout(resolve, 20));
          return store.write(name, value);
        },
      };
    },
  };
});

vi.mock('../../electron/vault/web-capture', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../electron/vault/web-capture')>();
  return {
    ...actual,
    captureWebPage: async (url: string) => {
      actual.validateCaptureUrl(url);
      return {
        sourceUrl: 'https://example.org/',
        title: mock.captureTitle,
        markdown: 'Captured content',
        images: [],
      };
    },
  };
});

let temporary = '';
const trusted = {};
const invoke = (channel: string, ...args: unknown[]) => mock.handlers.get(channel)!(trusted, ...args);

beforeEach(async () => {
  vi.resetModules();
  mock.handlers.clear();
  mock.quit = [];
  mock.confirm = 1;
  mock.failIndexRefreshAt = 0;
  mock.refreshCount = 0;
  mock.failReminderWrite = false;
  mock.partialRepairWrite = false;
  mock.failRecentWrite = false;
  mock.delayCredentialWrites = false;
  mock.captureTitle = '.Research';
  mock.notificationsSupported = false;
  mock.notifications = [];
  mock.reminderEvents = [];
  temporary = await mkdtemp(path.join(os.tmpdir(), 'a11y-ipc-'));
  mock.root = path.join(temporary, 'vault');
  mock.userData = path.join(temporary, 'app');
  await mkdir(mock.root);
  await mkdir(mock.userData);
  await mkdir(path.join(mock.root, 'Folder'));
  await writeFile(path.join(mock.root, 'Topic.md'), '# Topic\n\nalpha #research\n');
  await writeFile(path.join(mock.root, 'Reference.md'), '[[Topic|subject]] [Topic](Topic.md)');
  const { setupVaultIpc } = await import('../../electron/vault/ipc');
  setupVaultIpc(
    (event) => event === trusted,
    () => undefined,
    (event) => {
      mock.reminderEvents.push(event);
    },
  );
  await invoke(IPC_CHANNELS.vaultOpen);
});

afterEach(async () => {
  mock.quit.forEach((callback) => callback());
  await new Promise((resolve) => setTimeout(resolve, 30));
  await rm(temporary, { recursive: true, force: true });
});

describe('extended vault IPC integration', () => {
  it('preserves the original repaired note if a replacement write fails partially', async () => {
    mock.partialRepairWrite = true;
    await expect(invoke(IPC_CHANNELS.vaultMove, 'Topic.md', 'Folder/New.md')).rejects.toThrow('disk full');
    expect(await readFile(path.join(mock.root, 'Reference.md'), 'utf8')).toBe('[[Topic|subject]] [Topic](Topic.md)');
    expect(await readFile(path.join(mock.root, 'Topic.md'), 'utf8')).toContain('alpha');
    expect((await readdir(mock.root)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });
  it('retains the current service when remembering a candidate vault fails', async () => {
    const previous = mock.root;
    mock.root = path.join(temporary, 'other-vault');
    await mkdir(mock.root);
    await writeFile(path.join(mock.root, 'Topic.md'), '# Different vault\n');
    mock.failRecentWrite = true;
    await expect(invoke(IPC_CHANNELS.vaultOpen)).rejects.toThrow('persistence failed');
    await expect(invoke(IPC_CHANNELS.vaultGet)).resolves.toEqual(expect.objectContaining({ path: previous }));
    await expect(invoke(IPC_CHANNELS.vaultReadNote, 'Topic.md')).resolves.toContain('alpha');
  });
  it.each([1, 2])('rolls back committed disk mutations when index update %i fails', async (failure) => {
    mock.refreshCount = 0;
    mock.failIndexRefreshAt = failure;
    await expect(invoke(IPC_CHANNELS.vaultMove, 'Topic.md', 'Folder/New.md')).rejects.toThrow('Index write failed');
    expect(await readFile(path.join(mock.root, 'Topic.md'), 'utf8')).toContain('alpha');
    expect(await readFile(path.join(mock.root, 'Reference.md'), 'utf8')).toBe('[[Topic|subject]] [Topic](Topic.md)');
    await expect(readFile(path.join(mock.root, 'Folder/New.md'), 'utf8')).rejects.toThrow();
  });
  it('restarts scheduling after migration fails and rollback restores paths', async () => {
    await invoke(IPC_CHANNELS.vaultReminderCreate, {
      title: 'Future',
      path: 'Topic.md',
      scheduledAt: '2099-01-01 09:00',
    });
    mock.failReminderWrite = true;
    await expect(invoke(IPC_CHANNELS.vaultMove, 'Topic.md', 'Folder/New.md')).rejects.toThrow('migration failed');
    expect(await invoke(IPC_CHANNELS.vaultReminders)).toEqual([
      expect.objectContaining({ path: 'Topic.md', status: 'pending' }),
    ]);
    await expect(
      invoke(IPC_CHANNELS.vaultReminderCreate, { title: 'Another', path: 'Topic.md', scheduledAt: '2099-01-02 09:00' }),
    ).resolves.toHaveLength(2);
  });
  it('opens the migrated note when an already displayed notification is clicked', async () => {
    mock.notificationsSupported = true;
    await invoke(IPC_CHANNELS.vaultReminderCreate, {
      title: 'Past',
      path: 'Topic.md',
      scheduledAt: '2000-01-01 09:00',
    });
    expect(mock.notifications).toHaveLength(1);
    await invoke(IPC_CHANNELS.vaultMove, 'Topic.md', 'Folder/New.md');
    mock.notifications[0].emit('click');
    expect(mock.reminderEvents.at(-1)).toEqual(
      expect.objectContaining({
        type: 'open',
        reminder: expect.objectContaining({ path: 'Folder/New.md' }),
      }),
    );
  });
  it('locks a password-protected vault and encrypts notes with note-specific passwords and credentials', async () => {
    const original = await readFile(path.join(mock.root, 'Topic.md'), 'utf8');
    await invoke(IPC_CHANNELS.vaultSecuritySetup, 'correct horse battery');
    expect(await invoke(IPC_CHANNELS.vaultSecurityStatus)).toEqual({ enabled: true, locked: false });
    await invoke(IPC_CHANNELS.vaultNoteEncrypt, 'Topic.md', original, 'note-specific password');
    const encryptedOnDisk = await readFile(path.join(mock.root, 'Topic.md'), 'utf8');
    expect(encryptedOnDisk).not.toContain('alpha');
    await expect(invoke(IPC_CHANNELS.vaultReadNote, 'Topic.md')).resolves.toBe(original);
    await expect(invoke(IPC_CHANNELS.vaultSearch, { text: 'alpha' })).resolves.toEqual([]);

    await invoke(IPC_CHANNELS.vaultCredentialsSave, 'example', 'alice', 'secret');
    expect(await readFile(path.join(mock.root, '.a11ynotebook', 'credentials.json'), 'utf8')).not.toContain('secret');
    await expect(invoke(IPC_CHANNELS.vaultCredentialsRead)).resolves.toEqual([
      { id: 'example', username: 'alice', password: 'secret' },
    ]);

    await invoke(IPC_CHANNELS.vaultSecurityLock);
    expect(await invoke(IPC_CHANNELS.vaultSecurityStatus)).toEqual({ enabled: true, locked: true });
    expect(((await invoke(IPC_CHANNELS.vaultGet)) as { entries: unknown[] }).entries).toEqual([]);
    await writeFile(path.join(mock.root, 'Private.png'), new Uint8Array([1, 2, 3]));
    expect((await mock.protocol!({ url: 'vault-file://attachment/Private.png' })).status).toBe(423);
    await expect(invoke(IPC_CHANNELS.vaultReadNote, 'Topic.md')).rejects.toThrow(/Unlock the vault/);
    await expect(invoke(IPC_CHANNELS.vaultSecurityUnlock, 'wrong password')).rejects.toThrow(
      /Incorrect vault password/,
    );
    const reopened = await invoke(IPC_CHANNELS.vaultSecurityUnlock, 'correct horse battery');
    expect(reopened).toEqual(expect.objectContaining({ path: mock.root }));
    await expect(invoke(IPC_CHANNELS.vaultReadNote, 'Topic.md')).rejects.toThrow(/note’s password/);
    await expect(invoke(IPC_CHANNELS.vaultReadNote, 'Topic.md', 'wrong note password')).rejects.toThrow(
      /Incorrect note password/,
    );
    await expect(invoke(IPC_CHANNELS.vaultReadNote, 'Topic.md', 'note-specific password')).resolves.toBe(original);
    await invoke(IPC_CHANNELS.vaultSaveNote, 'Topic.md', '# Updated\n', original);
    expect(await readFile(path.join(mock.root, 'Topic.md'), 'utf8')).not.toContain('Updated');
    await expect(invoke(IPC_CHANNELS.vaultReadNote, 'Topic.md')).resolves.toBe('# Updated\n');
  });
  it('keeps concurrent credential updates in one read-modify-write sequence', async () => {
    await invoke(IPC_CHANNELS.vaultSecuritySetup, 'correct horse battery');
    mock.delayCredentialWrites = true;
    await Promise.all([
      invoke(IPC_CHANNELS.vaultCredentialsSave, 'first', 'alice', 'first-secret'),
      invoke(IPC_CHANNELS.vaultCredentialsSave, 'second', 'bob', 'second-secret'),
    ]);
    await expect(invoke(IPC_CHANNELS.vaultCredentialsRead)).resolves.toEqual(
      expect.arrayContaining([
        { id: 'first', username: 'alice', password: 'first-secret' },
        { id: 'second', username: 'bob', password: 'second-secret' },
      ]),
    );
  });
  it('does not apply password setup to a vault selected during key derivation', async () => {
    const setup = invoke(IPC_CHANNELS.vaultSecuritySetup, 'correct horse battery');
    const originalRoot = mock.root;
    mock.root = path.join(temporary, 'other-vault');
    await mkdir(mock.root);
    await writeFile(path.join(mock.root, 'Other.md'), '# Other\n');
    const open = invoke(IPC_CHANNELS.vaultOpen);
    await Promise.all([setup, open]);
    expect(await invoke(IPC_CHANNELS.vaultGet)).toEqual(expect.objectContaining({ path: mock.root }));
    await expect(readFile(path.join(mock.root, '.a11ynotebook', 'security.json'), 'utf8')).rejects.toThrow();
    const savedConfig = JSON.parse(await readFile(path.join(originalRoot, '.a11ynotebook', 'security.json'), 'utf8'));
    expect(savedConfig.version).toBe(1);
    expect(await invoke(IPC_CHANNELS.vaultSecurityStatus)).toEqual({ enabled: false, locked: false });
  });
  it('does not install an unlock key in a newly selected vault', async () => {
    await invoke(IPC_CHANNELS.vaultSecuritySetup, 'correct horse battery');
    await invoke(IPC_CHANNELS.vaultSecurityLock);
    const otherRoot = path.join(temporary, 'other-protected-vault');
    await mkdir(otherRoot);
    await mkdir(path.join(otherRoot, '.a11ynotebook'));
    const { createVaultSecurityConfig } = await import('../../electron/vault/security');
    const { config, key } = await createVaultSecurityConfig('another correct password');
    key.fill(0);
    await writeFile(path.join(otherRoot, '.a11ynotebook', 'security.json'), JSON.stringify(config));
    mock.root = otherRoot;
    const unlocking = invoke(IPC_CHANNELS.vaultSecurityUnlock, 'correct horse battery');
    const opening = invoke(IPC_CHANNELS.vaultOpen);
    await Promise.all([unlocking, opening]);
    expect(await invoke(IPC_CHANNELS.vaultSecurityStatus)).toEqual({ enabled: true, locked: true });
  });
  it('does not finish an unlock after a newer lock request', async () => {
    await invoke(IPC_CHANNELS.vaultSecuritySetup, 'correct horse battery');
    await invoke(IPC_CHANNELS.vaultSecurityLock);
    const unlocking = invoke(IPC_CHANNELS.vaultSecurityUnlock, 'correct horse battery');
    await invoke(IPC_CHANNELS.vaultSecurityLock);
    await expect(unlocking).rejects.toThrow(/changed while unlocking/);
    expect(await invoke(IPC_CHANNELS.vaultSecurityStatus)).toEqual({ enabled: true, locked: true });
  });
  it('creates captured notes with visible filenames when the remote title starts with dots', async () => {
    await invoke(IPC_CHANNELS.vaultCaptureWeb, 'https://example.org/', '');
    const vault = (await invoke(IPC_CHANNELS.vaultGet)) as { entries: { name: string }[] };
    expect(vault.entries.some(({ name }) => /^Research-[\da-f]{8}\.md$/i.test(name))).toBe(true);
    expect((await readdir(mock.root)).some((name) => name.startsWith('.Research'))).toBe(false);
  });
  it('rejects unsafe web capture destinations and paths before network access', async () => {
    await expect(invoke(IPC_CHANNELS.vaultCaptureWeb, 'http://127.0.0.1/', '')).rejects.toThrow(/HTTPS/);
    await expect(invoke(IPC_CHANNELS.vaultCaptureWeb, 'https://example.org/', '../outside')).rejects.toThrow(
      /valid inside this vault/,
    );
    await expect(invoke(IPC_CHANNELS.vaultCaptureWeb, 42, '')).rejects.toThrow(/Invalid web capture request/);
  });
  it('rejects untrusted senders on every registered channel', async () => {
    for (const handler of mock.handlers.values()) await expect(handler({})).rejects.toThrow('Untrusted');
  });
  it('repairs links and migrates annotation paths on a confirmed move', async () => {
    const annotation = (await invoke(IPC_CHANNELS.vaultAnnotationAdd, {
      path: 'Topic.md',
      anchor: { quote: 'Topic', prefix: '', suffix: '', start: 0, end: 5 },
      color: 'yellow',
      label: 'Important',
      comment: '',
    })) as { id: string };
    await invoke(IPC_CHANNELS.vaultMove, 'Topic.md', 'Folder/New.md');
    expect(await readFile(path.join(mock.root, 'Reference.md'), 'utf8')).toBe(
      '[[Folder/New|subject]] [Topic](Folder/New.md)',
    );
    expect(await invoke(IPC_CHANNELS.vaultAnnotations, 'Folder/New.md')).toEqual([
      expect.objectContaining({ id: annotation.id, path: 'Folder/New.md' }),
    ]);
    expect(await invoke(IPC_CHANNELS.vaultSearch, { text: 'alpha', tag: 'research' })).toEqual([
      expect.objectContaining({ path: 'Folder/New.md' }),
    ]);
  });
  it('leaves source notes untouched when the repair confirmation is cancelled', async () => {
    mock.confirm = 0;
    await invoke(IPC_CHANNELS.vaultRename, 'Topic.md', 'New.md');
    expect(await readFile(path.join(mock.root, 'Reference.md'), 'utf8')).toContain('[[Topic|subject]]');
    expect(await readFile(path.join(mock.root, 'Topic.md'), 'utf8')).toContain('alpha');
  });
  it('rejects stale saves and invalid paths without overwriting disk', async () => {
    await expect(invoke(IPC_CHANNELS.vaultSaveNote, 'Topic.md', 'mine', 'old baseline')).rejects.toThrow(
      'changed on disk',
    );
    await expect(invoke(IPC_CHANNELS.vaultMove, 'Topic.md', '../outside.md')).rejects.toThrow();
    await expect(invoke(IPC_CHANNELS.vaultReadAttachment, '../outside.txt')).rejects.toThrow();
    expect(await readFile(path.join(mock.root, 'Topic.md'), 'utf8')).toContain('alpha');
  });
  it('serves validated raster and PDF documents through the protocol', async () => {
    await writeFile(path.join(mock.root, 'Photo.png'), new Uint8Array([1, 2, 3]));
    await writeFile(
      path.join(mock.root, 'Guide.pdf'),
      Buffer.from(
        '%PDF-1.7\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R /Contents 4 0 R >> endobj\n4 0 obj << /Length 21 >> stream\nBT (Guide text) Tj ET\nendstream endobj\n',
        'latin1',
      ),
    );
    expect((await mock.protocol!({ url: 'vault-file://attachment/Photo.png' })).status).toBe(200);
    const documentResponse = await mock.protocol!({ url: 'vault-file://attachment/Guide.pdf' });
    expect(documentResponse.status).toBe(200);
    expect(documentResponse.headers.get('Content-Type')).toBe('application/pdf');
    await expect(invoke(IPC_CHANNELS.vaultReadAttachment, 'Guide.pdf')).resolves.toMatchObject({
      kind: '.pdf',
      pages: ['Guide text'],
    });
    expect((await mock.protocol!({ url: 'vault-file://attachment/Topic.md' })).status).toBe(415);
    expect((await mock.protocol!({ url: 'vault-file://attachment/%2e%2e/Photo.png' })).status).toBe(404);
    await symlink(path.join(mock.root, 'Photo.png'), path.join(mock.root, 'Escape.png'));
    expect((await mock.protocol!({ url: 'vault-file://attachment/Escape.png' })).status).toBe(404);
  });
  it('persists assets and schedules but rejects changed-deck ratings', async () => {
    await invoke(IPC_CHANNELS.vaultAssetCreate, 'Study.cards.md', 'Q :: A\n');
    const schedule = { repetitions: 1, interval: 1, ease: 2.5, due: '2026-10-04' };
    await invoke(IPC_CHANNELS.vaultFlashcardsSave, 'Study.cards.md', 'card-1', schedule, 'Q :: A\n');
    expect(await invoke(IPC_CHANNELS.vaultFlashcardsGet, 'Study.cards.md')).toEqual({ 'card-1': schedule });
    await expect(
      invoke(IPC_CHANNELS.vaultFlashcardsSave, 'Study.cards.md', 'card-1', schedule, 'wrong'),
    ).rejects.toThrow('deck changed');
    await expect(invoke(IPC_CHANNELS.vaultAssetSave, 'Study.cards.md', 'invalid', 'Q :: A\n')).rejects.toThrow();
  });
});
