// @vitest-environment node
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '../shared/ipc';
import { encryptRecord, unlockVault } from '../../electron/vault/security';
import { DEFAULT_REMINDER_DEFAULTS } from '../shared/reminder-defaults';
import type { Milestone } from '../shared/milestones';

const mock = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(),
  quit: [] as (() => void)[],
  root: '',
  userData: '',
  confirm: 1,
  failIndexRefreshAt: 0,
  refreshCount: 0,
  disableWatcher: false,
  failReminderWrite: false,
  partialRepairWrite: false,
  failRecentWrite: false,
  failSecurityWriteAt: 0,
  securityWriteCount: 0,
  derivationGate: undefined as undefined | (() => Promise<void>),
  derivedKeys: [] as Buffer[],
  captureGate: undefined as undefined | (() => Promise<void>),
  captureTitle: '.Research',
  attachmentReadGate: undefined as undefined | (() => Promise<void>),
  securityWriteGate: undefined as undefined | (() => Promise<void>),
  savePath: '',
  saveCanceled: false,
  saveOptions: undefined as unknown,
  notificationsSupported: false,
  notifications: [] as { emit: (event: string) => void }[],
  reminderEvents: [] as unknown[],
  protocol: undefined as undefined | ((request: { url: string }) => Promise<Response>),
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    readFile: async (...args: Parameters<typeof actual.readFile>) => {
      if (String(args[0]).endsWith('Private.png')) await mock.attachmentReadGate?.();
      return actual.readFile(...args);
    },
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

vi.mock('../../electron/vault/security', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../electron/vault/security')>();
  return {
    ...actual,
    createVaultSecurityConfig: async (...args: Parameters<typeof actual.createVaultSecurityConfig>) => {
      const result = await actual.createVaultSecurityConfig(...args);
      mock.derivedKeys.push(result.key);
      await mock.derivationGate?.();
      return result;
    },
    unlockVault: async (...args: Parameters<typeof actual.unlockVault>) => {
      const key = await actual.unlockVault(...args);
      mock.derivedKeys.push(key);
      await mock.derivationGate?.();
      return key;
    },
    encryptNoteWithPassword: async (...args: Parameters<typeof actual.encryptNoteWithPassword>) => {
      const result = await actual.encryptNoteWithPassword(...args);
      mock.derivedKeys.push(result.key);
      await mock.derivationGate?.();
      return result;
    },
    unlockPasswordEncryptedNote: async (...args: Parameters<typeof actual.unlockPasswordEncryptedNote>) => {
      const result = await actual.unlockPasswordEncryptedNote(...args);
      mock.derivedKeys.push(result.key);
      await mock.derivationGate?.();
      return result;
    },
  };
});

vi.mock('../../electron/vault/web-capture', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../electron/vault/web-capture')>();
  return {
    ...actual,
    captureWebPage: async (url: string) => {
      actual.validateCaptureUrl(url);
      await mock.captureGate?.();
      return {
        sourceUrl: url,
        title: mock.captureTitle,
        markdown: 'Captured content',
        html: '<h1>Research</h1>',
        images: [],
        omittedImages: 0,
      };
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
    showSaveDialog: async (options: unknown) => {
      mock.saveOptions = options;
      return { canceled: mock.saveCanceled, filePath: mock.savePath };
    },
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

vi.mock('../../electron/vault/watcher', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../electron/vault/watcher')>();
  return {
    ...actual,
    createVaultWatcher: (...args: Parameters<typeof actual.createVaultWatcher>) =>
      mock.disableWatcher ? Promise.resolve({ dispose: async () => undefined }) : actual.createVaultWatcher(...args),
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
          if (name === 'security.json' && ++mock.securityWriteCount === mock.failSecurityWriteAt) {
            throw new Error('Security metadata write failed.');
          }
          if (name === 'reminders.json' && mock.failReminderWrite) {
            mock.failReminderWrite = false;
            throw new Error('Reminder migration failed.');
          }
          await store.write(name, value);
          if (name === 'security.json') await mock.securityWriteGate?.();
        },
      };
    },
  };
});

let temporary = '';
const trusted = {};
const invoke = (channel: string, ...args: unknown[]) => mock.handlers.get(channel)!(trusted, ...args);

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

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
  mock.failSecurityWriteAt = 0;
  mock.securityWriteCount = 0;
  mock.derivationGate = undefined;
  mock.derivedKeys = [];
  mock.captureGate = undefined;
  mock.captureTitle = '.Research';
  mock.attachmentReadGate = undefined;
  mock.securityWriteGate = undefined;
  mock.saveCanceled = false;
  mock.saveOptions = undefined;
  mock.notificationsSupported = false;
  mock.notifications = [];
  mock.reminderEvents = [];
  temporary = await mkdtemp(path.join(os.tmpdir(), 'a11y-ipc-'));
  mock.root = path.join(temporary, 'vault');
  mock.userData = path.join(temporary, 'app');
  await mkdir(mock.root);
  await mkdir(mock.userData);
  mock.savePath = path.join(temporary, 'export.md');
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
  it('persists reminder defaults and applies creation preferences without rewriting existing reminders', async () => {
    const request = { title: 'Meeting', path: 'Topic.md', scheduledAt: '2099-10-05 12:30' };
    const original = await invoke(IPC_CHANNELS.vaultReminderCreate, request);
    const defaults = {
      ...DEFAULT_REMINDER_DEFAULTS,
      time: '12:30',
      privacy: 'hide-title',
      notification: { reminders: false, flashcards: true },
    };
    await invoke(IPC_CHANNELS.vaultReminderDefaultsSet, defaults);
    expect(await invoke(IPC_CHANNELS.vaultReminders)).toEqual(original);
    expect(await invoke(IPC_CHANNELS.vaultReminderCreate, { ...request, title: 'Private' })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: 'Private',
          privacy: 'hide-title',
          notification: false,
        }),
      ]),
    );
    await invoke(IPC_CHANNELS.vaultOpen);
    expect(await invoke(IPC_CHANNELS.vaultReminderDefaultsGet)).toEqual(defaults);
    await expect(invoke(IPC_CHANNELS.vaultReminderDefaultsSet, { ...defaults, time: '25:00' })).rejects.toThrow();
    expect(await invoke(IPC_CHANNELS.vaultReminderDefaultsGet)).toEqual(defaults);
  });

  it('supports milestone CRUD over IPC and preserves associations on folder moves', async () => {
    await writeFile(path.join(mock.root, 'Folder/Tasks.md'), '- [ ] Work');
    const milestone = (await invoke(IPC_CHANNELS.vaultMilestoneCreate, {
      title: 'Project',
      dueDate: '2026-10-10',
      status: 'active',
      notePaths: ['Folder/Tasks.md'],
      tasks: [{ path: 'Folder/Tasks.md', taskId: 'Folder/Tasks.md:1' }],
    })) as Milestone;
    await invoke(IPC_CHANNELS.vaultMove, 'Folder', 'Archive');
    const [moved] = (await invoke(IPC_CHANNELS.vaultMilestonesGet)) as Milestone[];
    expect(moved).toMatchObject({ id: milestone.id, notePaths: ['Archive/Tasks.md'] });
    expect(moved.tasks).toEqual([{ path: 'Archive/Tasks.md', taskId: milestone.tasks[0].taskId }]);
    expect(await invoke(IPC_CHANNELS.vaultMilestoneUpdate, moved.id, { title: 'Renamed' })).toMatchObject({
      id: milestone.id,
      title: 'Renamed',
    });
    await invoke(IPC_CHANNELS.vaultMilestoneDelete, moved.id);
    expect(await invoke(IPC_CHANNELS.vaultMilestonesGet)).toEqual([]);
  });

  it('rejects defaults and milestone requests from untrusted senders and locked vaults', async () => {
    const channels = [
      IPC_CHANNELS.vaultReminderDefaultsGet,
      IPC_CHANNELS.vaultReminderDefaultsSet,
      IPC_CHANNELS.vaultMilestonesGet,
      IPC_CHANNELS.vaultMilestoneCreate,
      IPC_CHANNELS.vaultMilestoneUpdate,
      IPC_CHANNELS.vaultMilestoneDelete,
    ];
    for (const channel of channels) await expect(mock.handlers.get(channel)!({})).rejects.toThrow();
    await invoke(IPC_CHANNELS.vaultMilestoneCreate, {
      title: 'Cached',
      dueDate: '2026-10-10',
      status: 'planned',
    });
    await invoke(IPC_CHANNELS.vaultSecuritySetup, 'phase-five-test-password');
    await invoke(IPC_CHANNELS.vaultSecurityLock);
    for (const channel of channels) await expect(invoke(channel)).rejects.toThrow('Unlock the vault');
  });

  it('enforces privacy and notification preferences for task reminders', async () => {
    mock.disableWatcher = true;
    try {
      await invoke(IPC_CHANNELS.vaultOpen);
      await invoke(IPC_CHANNELS.vaultReminderDefaultsSet, {
        ...DEFAULT_REMINDER_DEFAULTS,
        privacy: 'hide-title',
      });

      await writeFile(path.join(mock.root, 'Topic.md'), '- [ ] Private task remind:2020-01-01 09:00');
      await invoke(IPC_CHANNELS.vaultReminders);
      expect(mock.reminderEvents).toContainEqual(
        expect.objectContaining({
          type: 'fired',
          reminder: expect.objectContaining({ title: 'Reminder' }),
        }),
      );
      mock.reminderEvents = [];
      await invoke(IPC_CHANNELS.vaultReminderDefaultsSet, {
        ...DEFAULT_REMINDER_DEFAULTS,
        notification: { reminders: false, flashcards: false },
      });
      await writeFile(path.join(mock.root, 'Topic.md'), '- [ ] Silent task remind:2020-01-02 09:00');
      await invoke(IPC_CHANNELS.vaultReminders);
      expect(mock.reminderEvents.filter((event) => (event as { type: string }).type === 'fired')).toEqual([]);
    } finally {
      mock.disableWatcher = false;
    }
  });

  it('rejects milestone requests queued behind locking before reading or changing cached data', async () => {
    await invoke(IPC_CHANNELS.vaultSecuritySetup, 'phase-five-test-password');
    const input = { title: 'Private project', dueDate: '2026-10-10', status: 'active' };
    const milestone = (await invoke(IPC_CHANNELS.vaultMilestoneCreate, input)) as Milestone;
    const locking = invoke(IPC_CHANNELS.vaultSecurityLock);
    const queued = [
      invoke(IPC_CHANNELS.vaultMilestonesGet),
      invoke(IPC_CHANNELS.vaultMilestoneCreate, input),
      invoke(IPC_CHANNELS.vaultMilestoneUpdate, milestone.id, { title: 'Not permitted' }),
      invoke(IPC_CHANNELS.vaultMilestoneDelete, milestone.id),
    ];
    await Promise.all([locking, ...queued.map((request) => expect(request).rejects.toThrow('Unlock the vault'))]);
    await invoke(IPC_CHANNELS.vaultSecurityUnlock, 'phase-five-test-password');
    expect(await invoke(IPC_CHANNELS.vaultMilestonesGet)).toEqual([milestone]);
  });

  it('does not redeliver a fired task reminder when a milestone assigns its stable identity', async () => {
    mock.disableWatcher = true;
    try {
      await invoke(IPC_CHANNELS.vaultOpen);
      await writeFile(path.join(mock.root, 'Topic.md'), '- [ ] Read remind:2020-01-01 09:00');
      await invoke(IPC_CHANNELS.vaultReminders);
      expect(mock.reminderEvents.filter((event) => (event as { type: string }).type === 'fired')).toHaveLength(1);
      await invoke(IPC_CHANNELS.vaultMilestoneCreate, {
        title: 'Reading',
        dueDate: '2026-10-10',
        status: 'active',
        tasks: [{ path: 'Topic.md', taskId: 'Topic.md:1' }],
      });
      await invoke(IPC_CHANNELS.vaultReminders);
      expect(mock.reminderEvents.filter((event) => (event as { type: string }).type === 'fired')).toHaveLength(1);
    } finally {
      mock.disableWatcher = false;
    }
  });

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
  describe('index failure rollback', () => {
    beforeEach(async () => {
      // Background watcher refreshes must not consume the mutation's injected index failure.
      mock.disableWatcher = true;
      await invoke(IPC_CHANNELS.vaultOpen);
      await writeFile(path.join(mock.root, 'Another.md'), '[Topic](Topic.md)');
    });
    afterEach(() => {
      mock.disableWatcher = false;
    });
    it.each([1, 2, 3])('rolls back committed disk mutations when index update %i fails', async (failure) => {
      mock.refreshCount = 0;
      mock.failIndexRefreshAt = failure;
      await expect(invoke(IPC_CHANNELS.vaultMove, 'Topic.md', 'Folder/New.md')).rejects.toThrow('Index write failed');
      expect(await readFile(path.join(mock.root, 'Topic.md'), 'utf8')).toContain('alpha');
      expect(await readFile(path.join(mock.root, 'Reference.md'), 'utf8')).toBe('[[Topic|subject]] [Topic](Topic.md)');
      expect(await readFile(path.join(mock.root, 'Another.md'), 'utf8')).toBe('[Topic](Topic.md)');
      await expect(readFile(path.join(mock.root, 'Folder/New.md'), 'utf8')).rejects.toThrow();
      await expect(invoke(IPC_CHANNELS.vaultSearch, { text: 'alpha' })).resolves.toEqual([
        expect.objectContaining({ path: 'Topic.md' }),
      ]);
      await expect(invoke(IPC_CHANNELS.vaultMove, 'Topic.md', 'Folder/New.md')).resolves.toEqual(
        expect.objectContaining({ path: mock.root }),
      );
      expect(await readFile(path.join(mock.root, 'Reference.md'), 'utf8')).toBe(
        '[[Folder/New|subject]] [Topic](Folder/New.md)',
      );
      expect(await readFile(path.join(mock.root, 'Another.md'), 'utf8')).toBe('[Topic](Folder/New.md)');
      await expect(invoke(IPC_CHANNELS.vaultSearch, { text: 'alpha' })).resolves.toEqual([
        expect.objectContaining({ path: 'Folder/New.md' }),
      ]);
    });
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
    expect(await invoke(IPC_CHANNELS.vaultSecurityStatus)).toEqual({
      enabled: true,
      locked: false,
      recoveryAvailable: false,
    });
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
    expect(await invoke(IPC_CHANNELS.vaultSecurityStatus)).toEqual({
      enabled: true,
      locked: true,
      recoveryAvailable: false,
    });
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
  it.each([false, true])(
    'serializes concurrent credential saves, reads and deletes (recovery envelope: %s)',
    async (recovery) => {
      await invoke(IPC_CHANNELS.vaultSecuritySetup, 'correct horse battery');
      if (recovery) {
        await invoke(IPC_CHANNELS.vaultSecurityPrepareRecovery, 'correct horse battery');
        await invoke(IPC_CHANNELS.vaultSecurityAcknowledgeRecovery, true);
      }
      await Promise.all([
        invoke(IPC_CHANNELS.vaultCredentialsSave, 'first', 'alice', 'first-secret'),
        invoke(IPC_CHANNELS.vaultCredentialsSave, 'second', 'bob', 'second-secret'),
      ]);
      const saving = invoke(IPC_CHANNELS.vaultCredentialsSave, 'third', 'carol', 'third-secret');
      const deleting = invoke(IPC_CHANNELS.vaultCredentialsDelete, 'first');
      const reading = invoke(IPC_CHANNELS.vaultCredentialsRead);
      await Promise.all([saving, deleting]);
      await expect(reading).resolves.toEqual([
        { id: 'second', username: 'bob', password: 'second-secret' },
        { id: 'third', username: 'carol', password: 'third-secret' },
      ]);
    },
  );

  it('rejects password setup queued for a vault that has since changed', async () => {
    const original = mock.root;
    mock.root = path.join(temporary, 'other-vault');
    await mkdir(mock.root);
    const opening = invoke(IPC_CHANNELS.vaultOpen);
    await Promise.resolve();
    const setup = invoke(IPC_CHANNELS.vaultSecuritySetup, 'correct horse battery');
    await Promise.all([opening, expect(setup).rejects.toThrow(/changed/)]);
    for (const root of [original, mock.root])
      await expect(readFile(path.join(root, '.a11ynotebook', 'security.json'), 'utf8')).rejects.toThrow();
  });

  it('keeps password setup on its original vault when a switch is requested during derivation', async () => {
    const original = mock.root;
    const entered = deferred();
    const release = deferred();
    mock.derivationGate = () => {
      entered.resolve();
      return release.promise;
    };
    const setup = invoke(IPC_CHANNELS.vaultSecuritySetup, 'correct horse battery');
    await entered.promise;
    mock.root = path.join(temporary, 'other-vault');
    await mkdir(mock.root);
    const opening = invoke(IPC_CHANNELS.vaultOpen);
    release.resolve();
    await Promise.all([setup, opening]);
    expect(JSON.parse(await readFile(path.join(original, '.a11ynotebook', 'security.json'), 'utf8')).version).toBe(2);
    await expect(readFile(path.join(mock.root, '.a11ynotebook', 'security.json'), 'utf8')).rejects.toThrow();
    expect(await invoke(IPC_CHANNELS.vaultSecurityStatus)).toMatchObject({ enabled: false, locked: false });
  });

  it('cancels an in-flight unlock on a newer lock request and wipes its derived key', async () => {
    await invoke(IPC_CHANNELS.vaultSecuritySetup, 'correct horse battery');
    await invoke(IPC_CHANNELS.vaultSecurityLock);
    const entered = deferred();
    const release = deferred();
    mock.derivationGate = () => {
      entered.resolve();
      return release.promise;
    };
    const unlocking = invoke(IPC_CHANNELS.vaultSecurityUnlock, 'correct horse battery');
    await entered.promise;
    const rejected = expect(unlocking).rejects.toThrow(/changed/);
    const locking = invoke(IPC_CHANNELS.vaultSecurityLock);
    release.resolve();
    await Promise.all([rejected, locking]);
    expect(mock.derivedKeys.at(-1)?.every((byte) => byte === 0)).toBe(true);
    expect(await invoke(IPC_CHANNELS.vaultSecurityStatus)).toMatchObject({ enabled: true, locked: true });
  });

  it('does not reinstall a recovery key when locking races with the migration commit', async () => {
    await invoke(IPC_CHANNELS.vaultSecuritySetup, 'correct horse battery');
    await invoke(IPC_CHANNELS.vaultCredentialsSave, 'original', 'alice', 'secret');
    await invoke(IPC_CHANNELS.vaultSecurityPrepareRecovery, 'correct horse battery');
    const entered = deferred();
    const release = deferred();
    mock.securityWriteGate = () => {
      entered.resolve();
      return release.promise;
    };
    const acknowledging = invoke(IPC_CHANNELS.vaultSecurityAcknowledgeRecovery, true);
    await entered.promise;
    const rejected = expect(acknowledging).rejects.toThrow(/changed/);
    const locking = invoke(IPC_CHANNELS.vaultSecurityLock);
    release.resolve();
    await Promise.all([rejected, locking]);
    expect(await invoke(IPC_CHANNELS.vaultSecurityStatus)).toMatchObject({
      enabled: true,
      locked: true,
      recoveryAvailable: true,
    });
    mock.securityWriteGate = undefined;
    await invoke(IPC_CHANNELS.vaultSecurityUnlock, 'correct horse battery');
    await expect(invoke(IPC_CHANNELS.vaultCredentialsRead)).resolves.toEqual([
      { id: 'original', username: 'alice', password: 'secret' },
    ]);
  });

  it.each(['encrypt', 'unlock'])('discards a note key derived after vault locking (%s)', async (action) => {
    const original = await readFile(path.join(mock.root, 'Topic.md'), 'utf8');
    await invoke(IPC_CHANNELS.vaultSecuritySetup, 'correct horse battery');
    if (action === 'unlock') {
      await invoke(IPC_CHANNELS.vaultNoteEncrypt, 'Topic.md', original, 'note-specific password');
      await invoke(IPC_CHANNELS.vaultSecurityLock);
      await invoke(IPC_CHANNELS.vaultSecurityUnlock, 'correct horse battery');
    }
    const entered = deferred();
    const release = deferred();
    mock.derivationGate = () => {
      entered.resolve();
      return release.promise;
    };
    const operation =
      action === 'encrypt'
        ? invoke(IPC_CHANNELS.vaultNoteEncrypt, 'Topic.md', original, 'note-specific password')
        : invoke(IPC_CHANNELS.vaultReadNote, 'Topic.md', 'note-specific password');
    await entered.promise;
    const rejected = expect(operation).rejects.toThrow(/Unlock|changed/);
    await invoke(IPC_CHANNELS.vaultSecurityLock);
    release.resolve();
    await rejected;
    expect(mock.derivedKeys.at(-1)?.every((byte) => byte === 0)).toBe(true);
    if (action === 'encrypt') expect(await readFile(path.join(mock.root, 'Topic.md'), 'utf8')).toBe(original);
  });

  it('rejects credential operations queued behind a vault switch', async () => {
    await invoke(IPC_CHANNELS.vaultSecuritySetup, 'correct horse battery');
    await invoke(IPC_CHANNELS.vaultCredentialsSave, 'original', 'alice', 'secret');
    mock.root = path.join(temporary, 'other-vault');
    await mkdir(mock.root);
    const opening = invoke(IPC_CHANNELS.vaultOpen);
    await Promise.resolve();
    const queued = [
      invoke(IPC_CHANNELS.vaultCredentialsRead),
      invoke(IPC_CHANNELS.vaultCredentialsSave, 'wrong-vault', 'bob', 'secret'),
      invoke(IPC_CHANNELS.vaultCredentialsDelete, 'original'),
    ];
    await Promise.all([opening, ...queued.map((operation) => expect(operation).rejects.toThrow(/changed/))]);
    await expect(readFile(path.join(mock.root, '.a11ynotebook', 'credentials.json'), 'utf8')).rejects.toThrow();
  });

  it('does not serve attachment bytes after the vault locks during a read', async () => {
    await invoke(IPC_CHANNELS.vaultSecuritySetup, 'correct horse battery');
    await writeFile(path.join(mock.root, 'Private.png'), Buffer.from('private-image'));
    const entered = deferred();
    const release = deferred();
    mock.attachmentReadGate = () => {
      entered.resolve();
      return release.promise;
    };
    const reading = mock.protocol!({ url: 'vault-file://attachment/Private.png' });
    await entered.promise;
    await invoke(IPC_CHANNELS.vaultSecurityLock);
    release.resolve();
    const response = await reading;
    expect(response.status).toBe(423);
    expect(await response.text()).not.toContain('private-image');
  });

  it.each(['markdown', 'html'])('creates visible capture notes for dot-prefixed titles (%s)', async (format) => {
    for (const title of ['.Research', '. .Research', '.\u00a0.Research', '...']) {
      mock.captureTitle = title;
      const result = (await invoke(IPC_CHANNELS.vaultCaptureWeb, 'https://example.org/', '', format)) as {
        notePath: string;
        vault: { entries: { path: string }[] };
      };
      expect(result.notePath).toMatch(/^(?:Research|Web capture)-.*\.(?:md|html)$/);
      expect(result.vault.entries).toContainEqual(expect.objectContaining({ path: result.notePath }));
    }
  });

  it.each(['lock', 'switch'])('rejects a web capture if vault access changes during download (%s)', async (change) => {
    await invoke(IPC_CHANNELS.vaultSecuritySetup, 'correct horse battery');
    const original = mock.root;
    const entered = deferred();
    const release = deferred();
    mock.captureGate = () => {
      entered.resolve();
      return release.promise;
    };
    const capture = invoke(IPC_CHANNELS.vaultCaptureWeb, 'https://example.org/', '', 'markdown');
    await entered.promise;
    const rejected = expect(capture).rejects.toThrow(/Unlock|changed/);
    if (change === 'lock') await invoke(IPC_CHANNELS.vaultSecurityLock);
    else {
      mock.root = path.join(temporary, 'other-vault');
      await mkdir(mock.root);
      await invoke(IPC_CHANNELS.vaultOpen);
    }
    release.resolve();
    await rejected;
    expect((await readdir(original)).some((name) => name.startsWith('Research-') || name === 'Attachments')).toBe(
      false,
    );
  });

  it('atomically migrates credentials to a recovery envelope and resets the password without losing legacy notes', async () => {
    await invoke(IPC_CHANNELS.vaultSecuritySetup, 'correct horse battery');
    mock.securityWriteCount = 0;
    await invoke(IPC_CHANNELS.vaultCredentialsSave, 'example', 'alice', 'secret');
    const originalConfig = JSON.parse(
      await readFile(path.join(mock.root, '.a11ynotebook', 'security.json'), 'utf8'),
    ) as Parameters<typeof unlockVault>[0];
    const legacyKey = await unlockVault(originalConfig, 'correct horse battery');
    const encryptedNote = encryptRecord(legacyKey, 'note', 'legacy-note-1', '# Preserved legacy note');
    legacyKey.fill(0);
    await writeFile(path.join(mock.root, 'Legacy.md'), JSON.stringify(encryptedNote));

    await expect(invoke(IPC_CHANNELS.vaultSecurityPrepareRecovery, 'wrong password')).rejects.toThrow(
      /Incorrect vault password/,
    );
    await invoke(IPC_CHANNELS.vaultSecurityPrepareRecovery, 'correct horse battery');
    await invoke(IPC_CHANNELS.vaultSecurityAcknowledgeRecovery, false);
    expect(JSON.parse(await readFile(path.join(mock.root, '.a11ynotebook', 'security.json'), 'utf8')).version).toBe(2);
    const recoveryKey = (await invoke(IPC_CHANNELS.vaultSecurityPrepareRecovery, 'correct horse battery')) as string;
    await invoke(IPC_CHANNELS.vaultSecurityAcknowledgeRecovery, true);

    const recoverableConfig = JSON.parse(
      await readFile(path.join(mock.root, '.a11ynotebook', 'security.json'), 'utf8'),
    ) as { version: number };
    expect(recoverableConfig.version).toBe(3);
    await expect(readFile(path.join(mock.root, '.a11ynotebook', 'credentials.json'), 'utf8')).rejects.toThrow();
    expect(await readFile(path.join(mock.root, '.a11ynotebook', 'security.json'), 'utf8')).not.toContain('secret');
    await expect(invoke(IPC_CHANNELS.vaultCredentialsRead)).resolves.toEqual([
      { id: 'example', username: 'alice', password: 'secret' },
    ]);
    await invoke(IPC_CHANNELS.vaultCredentialsSave, 'secondary', 'bob', 'another secret');
    expect(await invoke(IPC_CHANNELS.vaultCredentialsRead)).toHaveLength(2);
    await invoke(IPC_CHANNELS.vaultCredentialsDelete, 'secondary');
    await expect(invoke(IPC_CHANNELS.vaultCredentialsRead)).resolves.toEqual([
      { id: 'example', username: 'alice', password: 'secret' },
    ]);
    await expect(invoke(IPC_CHANNELS.vaultReadNote, 'Legacy.md')).resolves.toBe('# Preserved legacy note');

    await invoke(IPC_CHANNELS.vaultSecurityLock);
    await expect(invoke(IPC_CHANNELS.vaultSecurityRecover, 'malformed', 'new vault password')).rejects.toThrow();
    await invoke(IPC_CHANNELS.vaultSecurityRecover, recoveryKey, 'new vault password');
    await expect(invoke(IPC_CHANNELS.vaultSecurityUnlock, 'correct horse battery')).rejects.toThrow(
      /Incorrect vault password/,
    );
    await expect(invoke(IPC_CHANNELS.vaultCredentialsRead)).resolves.toEqual([
      { id: 'example', username: 'alice', password: 'secret' },
    ]);
    await invoke(IPC_CHANNELS.vaultSaveNote, 'Legacy.md', '# Updated legacy note', '# Preserved legacy note');
    expect(await invoke(IPC_CHANNELS.vaultReadNote, 'Legacy.md')).toBe('# Updated legacy note');
    expect(await invoke(IPC_CHANNELS.vaultSecurityStatus)).toEqual({
      enabled: true,
      locked: false,
      recoveryAvailable: true,
    });
    const replacementRecoveryKey = (await invoke(
      IPC_CHANNELS.vaultSecurityPrepareRecovery,
      'new vault password',
    )) as string;
    await invoke(IPC_CHANNELS.vaultSecurityAcknowledgeRecovery, true);
    await invoke(IPC_CHANNELS.vaultSecurityLock);
    await expect(invoke(IPC_CHANNELS.vaultSecurityRecover, recoveryKey, 'another password')).rejects.toThrow(
      /Recovery key/,
    );
    await invoke(IPC_CHANNELS.vaultSecurityUnlock, 'new vault password');
    await invoke(IPC_CHANNELS.vaultSecurityRevokeRecovery, 'new vault password');
    expect(await invoke(IPC_CHANNELS.vaultSecurityStatus)).toMatchObject({ recoveryAvailable: false });
    await invoke(IPC_CHANNELS.vaultSecurityLock);
    await expect(invoke(IPC_CHANNELS.vaultSecurityRecover, replacementRecoveryKey, 'another password')).rejects.toThrow(
      /not configured/,
    );
    await invoke(IPC_CHANNELS.vaultSecurityUnlock, 'new vault password');
    const protectedRoot = mock.root;
    mock.root = path.join(temporary, 'unprotected-vault');
    await mkdir(mock.root);
    await writeFile(path.join(mock.root, 'Other.md'), 'Other vault');
    await invoke(IPC_CHANNELS.vaultOpen);
    expect(await invoke(IPC_CHANNELS.vaultSecurityStatus)).toMatchObject({
      enabled: false,
      locked: false,
      recoveryAvailable: false,
    });
    mock.root = protectedRoot;
    await invoke(IPC_CHANNELS.vaultOpen);
    expect(await invoke(IPC_CHANNELS.vaultSecurityStatus)).toMatchObject({
      enabled: true,
      locked: true,
      recoveryAvailable: false,
    });
    await invoke(IPC_CHANNELS.vaultSecurityUnlock, 'new vault password');
    await expect(invoke(IPC_CHANNELS.vaultCredentialsRead)).resolves.toEqual([
      { id: 'example', username: 'alice', password: 'secret' },
    ]);
  });
  it('cleans up credentials saved after recovery preparation', async () => {
    await invoke(IPC_CHANNELS.vaultSecuritySetup, 'correct horse battery');
    const recoveryKey = await invoke(IPC_CHANNELS.vaultSecurityPrepareRecovery, 'correct horse battery');
    await invoke(IPC_CHANNELS.vaultCredentialsSave, 'example', 'alice', 'secret');
    await invoke(IPC_CHANNELS.vaultSecurityAcknowledgeRecovery, true);
    await expect(readFile(path.join(mock.root, '.a11ynotebook', 'credentials.json'), 'utf8')).rejects.toThrow();
    await invoke(IPC_CHANNELS.vaultSecurityLock);
    await invoke(IPC_CHANNELS.vaultSecurityRecover, recoveryKey, 'new vault password');
    expect(await invoke(IPC_CHANNELS.vaultCredentialsRead)).toEqual([
      { id: 'example', username: 'alice', password: 'secret' },
    ]);
    await invoke(IPC_CHANNELS.vaultCredentialsDelete, 'example');
    expect(await invoke(IPC_CHANNELS.vaultCredentialsRead)).toEqual([]);
  });
  it('keeps the legacy security record and credentials when atomic recovery migration fails', async () => {
    await invoke(IPC_CHANNELS.vaultSecuritySetup, 'correct horse battery');
    mock.securityWriteCount = 0;
    await invoke(IPC_CHANNELS.vaultCredentialsSave, 'example', 'alice', 'secret');
    const recoveryKey = await invoke(IPC_CHANNELS.vaultSecurityPrepareRecovery, 'correct horse battery');
    mock.failSecurityWriteAt = 1;
    await expect(invoke(IPC_CHANNELS.vaultSecurityAcknowledgeRecovery, true)).rejects.toThrow(
      /Security metadata write failed/,
    );
    const config = JSON.parse(await readFile(path.join(mock.root, '.a11ynotebook', 'security.json'), 'utf8'));
    expect(config.version).toBe(2);
    await expect(invoke(IPC_CHANNELS.vaultCredentialsRead)).resolves.toEqual([
      { id: 'example', username: 'alice', password: 'secret' },
    ]);
    await invoke(IPC_CHANNELS.vaultSecurityAcknowledgeRecovery, true);
    await invoke(IPC_CHANNELS.vaultSecurityLock);
    await invoke(IPC_CHANNELS.vaultSecurityRecover, recoveryKey, 'new vault password');
    await expect(invoke(IPC_CHANNELS.vaultCredentialsRead)).resolves.toEqual([
      { id: 'example', username: 'alice', password: 'secret' },
    ]);
  });
  it('defers credential-copy cleanup until recovery unlock after an interrupted migration', async () => {
    const oldPassword = 'correct horse battery';
    await invoke(IPC_CHANNELS.vaultSecuritySetup, oldPassword);
    mock.securityWriteCount = 0;
    await invoke(IPC_CHANNELS.vaultCredentialsSave, 'example', 'alice', 'secret');
    const recoveryKey = await invoke(IPC_CHANNELS.vaultSecurityPrepareRecovery, oldPassword);
    mock.failSecurityWriteAt = 2;
    await expect(invoke(IPC_CHANNELS.vaultSecurityAcknowledgeRecovery, true)).rejects.toThrow(/Recovery was committed/);
    const committed = JSON.parse(await readFile(path.join(mock.root, '.a11ynotebook', 'security.json'), 'utf8'));
    expect(committed.version).toBe(3);
    expect(committed.legacyCredentialsCleanupRequired).toBe(true);
    expect(await invoke(IPC_CHANNELS.vaultSecurityStatus)).toMatchObject({ locked: true, recoveryAvailable: true });

    await invoke(IPC_CHANNELS.vaultOpen);
    await expect(readFile(path.join(mock.root, '.a11ynotebook', 'credentials.json'), 'utf8')).rejects.toThrow();
    await invoke(IPC_CHANNELS.vaultSecurityRecover, recoveryKey, 'new vault password');
    await expect(readFile(path.join(mock.root, '.a11ynotebook', 'credentials.json'), 'utf8')).rejects.toThrow();
    await expect(invoke(IPC_CHANNELS.vaultCredentialsRead)).resolves.toEqual([
      { id: 'example', username: 'alice', password: 'secret' },
    ]);
  });
  it('requires explicit consent for protected exports and uses the native save dialog', async () => {
    const original = await readFile(path.join(mock.root, 'Topic.md'), 'utf8');
    await invoke(IPC_CHANNELS.vaultSecuritySetup, 'correct horse battery');
    await invoke(IPC_CHANNELS.vaultNoteEncrypt, 'Topic.md', original, 'note-specific password');
    await expect(invoke(IPC_CHANNELS.vaultExportNote, 'Topic.md', 'markdown', original, false)).rejects.toThrow(
      /Explicit consent/,
    );
    await expect(invoke(IPC_CHANNELS.vaultExportNote, 'Topic.md', 'markdown', original, true)).resolves.toEqual({
      cancelled: false,
      omittedImages: 0,
    });
    expect(await readFile(mock.savePath, 'utf8')).toBe(original);
    expect(mock.saveOptions).toEqual(expect.objectContaining({ properties: ['showOverwriteConfirmation'] }));
    expect(await readFile(path.join(mock.root, 'Topic.md'), 'utf8')).not.toContain('alpha');
  });
  it('exports sanitized HTML with embedded local images and preserves the source note', async () => {
    const note = '<h1>Research</h1><script>unsafe()</script><img src="Images/chart.png" alt="Chart">';
    await mkdir(path.join(mock.root, 'Images'));
    await writeFile(path.join(mock.root, 'Images', 'chart.png'), Buffer.from([137, 80, 78, 71]));
    await writeFile(path.join(mock.root, 'Research.html'), note);
    mock.savePath = path.join(temporary, 'research.html');
    await expect(invoke(IPC_CHANNELS.vaultExportNote, 'Research.html', 'html', note, false)).resolves.toEqual({
      cancelled: false,
      omittedImages: 0,
    });
    const output = await readFile(mock.savePath, 'utf8');
    expect(output).toContain('data:image/png;base64,');
    expect(output).toContain('<h1>Research</h1>');
    expect(output).not.toContain('<script');
    expect(await readFile(path.join(mock.root, 'Research.html'), 'utf8')).toBe(note);
  });
  it('does not write when the native export dialog is cancelled', async () => {
    mock.saveCanceled = true;
    await expect(invoke(IPC_CHANNELS.vaultExportNote, 'Topic.md', 'markdown', '# Copy', false)).resolves.toEqual({
      cancelled: true,
      omittedImages: 0,
    });
    await expect(readFile(mock.savePath, 'utf8')).rejects.toThrow();
  });
  it('rejects unsafe web capture destinations and paths before network access', async () => {
    await expect(invoke(IPC_CHANNELS.vaultCaptureWeb, 'http://127.0.0.1/', '', 'markdown')).rejects.toThrow(/HTTPS/);
    await expect(
      invoke(IPC_CHANNELS.vaultCaptureWeb, 'https://example.org/', '../outside', 'markdown'),
    ).rejects.toThrow(/valid inside this vault/);
    await expect(invoke(IPC_CHANNELS.vaultCaptureWeb, 42, '', 'markdown')).rejects.toThrow(
      /Invalid web capture request/,
    );
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
      Buffer.from('%PDF-1.7\n<< /Length 24 >>\nstream\nBT (Guide text) Tj ET\nendstream\n', 'latin1'),
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
