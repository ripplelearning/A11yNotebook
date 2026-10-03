// Owns the narrow, validated IPC boundary for local vault filesystem operations.
import { copyFile, lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { app, dialog, ipcMain, Notification, protocol, shell, type IpcMainInvokeEvent } from 'electron';
import { IPC_CHANNELS } from '../../src/shared/ipc';
import { createVaultService } from './service';
import { createAnnotationStore } from './annotations';
import { createMetadataStore } from './metadata';
import { IMAGE_TYPES, protocolPath, readTextAttachment } from './attachments';
import { planLinkRepair, type NoteSource } from './link-repair';
import { DEFAULT_SETTINGS, validateSettings } from '../../src/shared/settings';
import type { VaultChangedEvent } from '../../src/shared/search';
import type { NewAnnotation, AnnotationUpdate } from '../../src/shared/annotations';
import type { VaultEntry } from '../../src/shared/types';
import { createReminderService } from './reminders';
import type { CreateReminderInput, VaultReminderEvent, SnoozeDuration } from '../../src/shared/reminders';
import { createAssetStore } from './assets';

type TrustedSender = (event: IpcMainInvokeEvent) => boolean;
type VaultService = ReturnType<typeof createVaultService>;

const recentFile = () => path.join(app.getPath('userData'), 'recent-vault.json');
let service: VaultService | null = null;
let metadata: ReturnType<typeof createMetadataStore> | null = null;
let annotations: ReturnType<typeof createAnnotationStore> | null = null;
let sendChanged: (event: VaultChangedEvent) => void = () => undefined;
let reminderService: ReturnType<typeof createReminderService> | null = null;
let assets: ReturnType<typeof createAssetStore> | null = null;
let sendReminder: (event: VaultReminderEvent) => void = () => undefined;
const notifications = new Set<Notification>();

function assertTrusted(event: IpcMainInvokeEvent, isTrustedSender: TrustedSender) {
  if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender.');
}

function requireService() {
  if (!service) throw new Error('Open a vault first.');
  return service;
}

async function rememberVault(vaultPath: string) {
  await mkdir(path.dirname(recentFile()), { recursive: true });
  await writeFile(recentFile(), JSON.stringify({ lastOpened: vaultPath }), 'utf8');
}

async function openVault(vaultPath: string) {
  const nextService = createVaultService(vaultPath);
  const vault = await nextService.initialize();
  reminderService?.stop();
  for (const notification of notifications) notification.close();
  notifications.clear();
  await service?.dispose();
  service = nextService;
  metadata = createMetadataStore(nextService);
  assets = createAssetStore(nextService, metadata);
  annotations = createAnnotationStore({
    read: () => metadataFor(nextService).read('annotations.json'),
    write: (value) => metadataFor(nextService).write('annotations.json', value),
    validateNote: async (relative) => {
      await nextService.resolveEntry(relative);
    },
  });
  const nextReminders = createReminderService({
    readStore: () => metadataFor(nextService).read('reminders.json'),
    writeStore: (value) => metadataFor(nextService).write('reminders.json', value),
    validateNote: async (relative) => {
      await nextService.readNote(relative);
    },
    getNotes: async () => {
      const notes: NoteSource[] = [];
      async function collect(entries: VaultEntry[]) {
        for (const entry of entries) {
          if (entry.kind === 'note') notes.push({ path: entry.path, content: await nextService.readNote(entry.path) });
          if (entry.children) await collect(entry.children);
        }
      }
      await collect((await nextService.getVault()).entries);
      return notes;
    },
    notify: (reminder) => {
      if (service !== nextService) return;
      sendReminder({ type: 'fired', vaultPath: vault.path, reminder });
      if (Notification.isSupported()) {
        const notification = new Notification({ title: 'A11y Notebook reminder', body: reminder.title });
        notifications.add(notification);
        notification.on('click', () => {
          if (service === nextService) sendReminder({ type: 'open', vaultPath: vault.path, reminder });
        });
        notification.on('close', () => notifications.delete(notification));
        notification.show();
      }
    },
    onChange: (reminders) => {
      if (service === nextService) sendReminder({ type: 'changed', vaultPath: vault.path, reminders });
    },
    onError: () => {
      if (service === nextService)
        sendReminder({ type: 'error', vaultPath: vault.path, message: 'Could not update reminders.' });
    },
  });
  reminderService = nextReminders;
  await nextReminders.initialize().catch(() =>
    sendReminder({
      type: 'error',
      vaultPath: vault.path,
      message: 'Could not initialize reminders. Check vault metadata.',
    }),
  );
  await nextService
    .startWatcher(
      (event) => {
        sendChanged(event);
        void nextReminders.refresh().catch(() => undefined);
      },
      () => {
        if (service === nextService)
          sendReminder({
            type: 'error',
            vaultPath: vault.path,
            message: 'Could not synchronize external changes. Use Refresh links and check file permissions.',
          });
      },
    )
    .catch(() =>
      sendReminder({
        type: 'error',
        vaultPath: vault.path,
        message: 'External-change watching is unavailable. Use Refresh links to refresh manually.',
      }),
    );
  await rememberVault(vault.path);
  return vault;
}

function metadataFor(vault: VaultService) {
  if (vault !== service || !metadata) throw new Error('The open vault has changed. Retry the operation.');
  return metadata;
}

async function relocate(relative: string, destination: string) {
  const vault = requireService();
  await vault.resolveEntry(relative);
  await vault.resolveEntry(destination, true);
  if (/\.md$/i.test(relative) && !/\.md$/i.test(destination))
    throw new Error('Markdown notes must keep the .md extension.');
  const notes: NoteSource[] = [];
  const attachmentPaths: string[] = [];
  async function collect(entries: VaultEntry[]) {
    for (const entry of entries) {
      if (entry.kind === 'note') notes.push({ path: entry.path, content: await vault.readNote(entry.path) });
      if (entry.kind === 'attachment') attachmentPaths.push(entry.path);
      if (entry.children) await collect(entry.children);
    }
  }
  await collect((await vault.getVault()).entries);
  const repairs = planLinkRepair(notes, relative, destination, attachmentPaths);
  const answer = await dialog.showMessageBox({
    type: 'question',
    title: 'Move item and repair links',
    message: `Move “${relative}” to “${destination}”?`,
    detail: repairs.length
      ? `Links will be rewritten in:\n${repairs.map((item) => item.path).join('\n')}`
      : 'No local links need rewriting.',
    buttons: ['Cancel', 'Move and repair links'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  });
  if (answer.response !== 1) return vault.getVault();
  metadataFor(vault);
  for (const item of repairs) {
    if ((await vault.readNote(item.path)) !== item.before)
      throw new Error('A note changed while confirming. Please retry.');
  }
  const store = metadataFor(vault);
  const annotationSnapshot = await store.read('annotations.json');
  const flashcards = await store.read('flashcards.json');
  const imageAlts = await store.read('image-alts.json');
  const reminderSnapshot = await store.read('reminders.json');
  const written: typeof repairs = [];
  let moved = false;
  let rolledBack = false;
  const rollback = async () => {
    if (!moved || rolledBack) return;
    rolledBack = true;
    for (const item of written.reverse())
      await vault.saveNote(item.nextPath, item.before, item.after).catch(() => undefined);
    await vault.moveEntry(destination, relative).catch(() => undefined);
    await store.write('annotations.json', annotationSnapshot).catch(() => undefined);
    await store.write('flashcards.json', flashcards).catch(() => undefined);
    await store.write('image-alts.json', imageAlts).catch(() => undefined);
    await store.write('reminders.json', reminderSnapshot).catch(() => undefined);
  };
  const operation = async () => {
    try {
      await vault.moveEntry(relative, destination);
      moved = true;
      for (const item of repairs) {
        await vault.saveNote(item.nextPath, item.after, item.before);
        written.push(item);
      }
      await annotations?.migratePaths(relative, destination);
      for (const [filename, snapshot] of [
        ['flashcards.json', flashcards],
        ['image-alts.json', imageAlts],
      ] as const) {
        if (snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)) {
          await store.write(
            filename,
            Object.fromEntries(
              Object.entries(snapshot).map(([key, value]) => [
                key === relative || key.startsWith(`${relative}/`) ? destination + key.slice(relative.length) : key,
                value,
              ]),
            ),
          );
        }
      }
      return vault.getVault();
    } catch (error) {
      await rollback();
      throw error;
    }
  };
  try {
    return reminderService
      ? await reminderService.withPathMigration(relative, destination, operation)
      : await operation();
  } catch (error) {
    await rollback();
    throw error;
  }
}

/** Register fixed handlers; every operation checks the top-level trusted renderer. */
export function setupVaultIpc(
  isTrustedSender: TrustedSender,
  onChanged: (event: VaultChangedEvent) => void,
  onReminder: (event: VaultReminderEvent) => void,
) {
  sendChanged = onChanged;
  sendReminder = onReminder;
  ipcMain.handle(IPC_CHANNELS.vaultAssetRead, async (event, relative: unknown) => {
    assertTrusted(event, isTrustedSender);
    if (typeof relative !== 'string' || !assets) throw new Error('Invalid asset request.');
    return assets.read(relative);
  });
  ipcMain.handle(IPC_CHANNELS.vaultAssetSave, async (event, relative: unknown, content: unknown, expected: unknown) => {
    assertTrusted(event, isTrustedSender);
    if (typeof relative !== 'string' || typeof content !== 'string' || typeof expected !== 'string' || !assets)
      throw new Error('Invalid asset save.');
    await assets.save(relative, content, expected);
    await requireService().refreshSearchIndex();
  });
  ipcMain.handle(IPC_CHANNELS.vaultAssetCreate, async (event, relative: unknown, content: unknown) => {
    assertTrusted(event, isTrustedSender);
    if (typeof relative !== 'string' || typeof content !== 'string' || !assets)
      throw new Error('Invalid asset creation.');
    await assets.create(relative, content);
    await requireService().refreshSearchIndex();
    return requireService().getVault();
  });
  ipcMain.handle(IPC_CHANNELS.vaultFlashcardsGet, async (event, relative: unknown) => {
    assertTrusted(event, isTrustedSender);
    if (typeof relative !== 'string' || !assets) throw new Error('Invalid deck request.');
    return assets.getSchedules(relative);
  });
  ipcMain.handle(
    IPC_CHANNELS.vaultFlashcardsSave,
    async (event, relative: unknown, id: unknown, schedule: unknown, expected: unknown) => {
      assertTrusted(event, isTrustedSender);
      if (typeof relative !== 'string' || typeof id !== 'string' || typeof expected !== 'string' || !assets)
        throw new Error('Invalid deck rating.');
      await assets.saveSchedule(relative, id, schedule, expected);
    },
  );
  app.on('before-quit', () => {
    void service?.dispose().catch(() => undefined);
    reminderService?.stop();
  });
  ipcMain.handle(IPC_CHANNELS.vaultReminders, async (event) => {
    assertTrusted(event, isTrustedSender);
    if (!reminderService) throw new Error('Open a vault first.');
    return reminderService.getReminders();
  });
  ipcMain.handle(IPC_CHANNELS.vaultReminderCreate, async (event, input: unknown) => {
    assertTrusted(event, isTrustedSender);
    if (!reminderService) throw new Error('Open a vault first.');
    await reminderService.createReminder(input as CreateReminderInput);
    return reminderService.getReminders();
  });
  ipcMain.handle(IPC_CHANNELS.vaultReminderDismiss, async (event, id: unknown) => {
    assertTrusted(event, isTrustedSender);
    if (typeof id !== 'string' || id.length > 8192 || !reminderService) throw new Error('Invalid reminder.');
    return reminderService.dismissReminder(id);
  });
  ipcMain.handle(IPC_CHANNELS.vaultReminderSnooze, async (event, id: unknown, duration: unknown) => {
    assertTrusted(event, isTrustedSender);
    if (
      typeof id !== 'string' ||
      id.length > 8192 ||
      ![5, 15, 60, 'tomorrow'].includes(duration as SnoozeDuration) ||
      !reminderService
    )
      throw new Error('Invalid snooze request.');
    return reminderService.snoozeReminder(id, duration as SnoozeDuration);
  });
  protocol.handle('vault-file', async (request) => {
    try {
      const relative = protocolPath(request.url);
      const mime = IMAGE_TYPES[path.extname(relative).toLowerCase()];
      if (!mime) return new Response('Unsupported preview.', { status: 415 });
      const target = await requireService().resolveEntry(relative);
      const stat = await lstat(target);
      if (!stat.isFile() || stat.size > 20 * 1024 * 1024) return new Response('Image too large.', { status: 413 });
      const bytes = await readFile(target);
      return new Response(new Uint8Array(bytes), {
        headers: { 'Content-Type': mime, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' },
      });
    } catch {
      return new Response('Attachment not available.', { status: 404 });
    }
  });
  ipcMain.handle(IPC_CHANNELS.vaultOpen, async (event) => {
    assertTrusted(event, isTrustedSender);
    const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
    return result.canceled || !result.filePaths[0] ? null : openVault(result.filePaths[0]);
  });
  ipcMain.handle(IPC_CHANNELS.vaultGet, async (event) => {
    assertTrusted(event, isTrustedSender);
    if (service) return service.getVault();
    try {
      const saved = JSON.parse(await readFile(recentFile(), 'utf8')) as { lastOpened?: unknown };
      if (typeof saved.lastOpened !== 'string') return null;
      return await openVault(saved.lastOpened);
    } catch {
      return null;
    }
  });
  ipcMain.handle(IPC_CHANNELS.vaultReadNote, async (event, relativePath: unknown) => {
    assertTrusted(event, isTrustedSender);
    if (typeof relativePath !== 'string') throw new Error('Note path must be text.');
    return requireService().readNote(relativePath);
  });
  ipcMain.handle(
    IPC_CHANNELS.vaultSaveNote,
    async (event, relativePath: unknown, content: unknown, expectedContent: unknown) => {
      assertTrusted(event, isTrustedSender);
      if (typeof relativePath !== 'string' || typeof content !== 'string') throw new Error('Invalid note data.');
      if (expectedContent !== undefined && typeof expectedContent !== 'string')
        throw new Error('Invalid saved note baseline.');
      await requireService().saveNote(relativePath, content, expectedContent);
    },
  );
  ipcMain.handle(IPC_CHANNELS.vaultCreateNotebook, async (event, relativePath: unknown) => {
    assertTrusted(event, isTrustedSender);
    if (typeof relativePath !== 'string') throw new Error('Notebook path must be text.');
    return requireService().createFolder(relativePath);
  });
  ipcMain.handle(IPC_CHANNELS.vaultCreateNote, async (event, relativePath: unknown, content: unknown) => {
    assertTrusted(event, isTrustedSender);
    if (typeof relativePath !== 'string' || (content !== undefined && typeof content !== 'string'))
      throw new Error('Invalid note creation data.');
    return requireService().createNote(relativePath, content);
  });
  ipcMain.handle(IPC_CHANNELS.vaultRename, async (event, relativePath: unknown, name: unknown) => {
    assertTrusted(event, isTrustedSender);
    if (typeof relativePath !== 'string' || typeof name !== 'string') throw new Error('Invalid rename request.');
    if (!name || name === '.' || name === '..' || /[\\/:]/.test(name)) throw new Error('Invalid item name.');
    return relocate(relativePath, path.posix.join(path.posix.dirname(relativePath), name));
  });
  ipcMain.handle(IPC_CHANNELS.vaultMove, async (event, relative: unknown, destination: unknown) => {
    assertTrusted(event, isTrustedSender);
    if (typeof relative !== 'string' || typeof destination !== 'string') throw new Error('Invalid move request.');
    return relocate(relative, destination);
  });
  ipcMain.handle(IPC_CHANNELS.vaultSearch, async (event, query: unknown) => {
    assertTrusted(event, isTrustedSender);
    return requireService().search(query);
  });
  ipcMain.handle(IPC_CHANNELS.vaultTags, async (event) => {
    assertTrusted(event, isTrustedSender);
    return requireService().getTags();
  });
  ipcMain.handle(IPC_CHANNELS.vaultAnnotations, async (event, relative: unknown) => {
    assertTrusted(event, isTrustedSender);
    if (typeof relative !== 'string' || !annotations) throw new Error('Invalid annotation request.');
    return annotations.list(relative);
  });
  ipcMain.handle(IPC_CHANNELS.vaultAnnotationAdd, async (event, value: unknown) => {
    assertTrusted(event, isTrustedSender);
    if (!annotations) throw new Error('Open a vault first.');
    return annotations.add(value as NewAnnotation);
  });
  ipcMain.handle(IPC_CHANNELS.vaultAnnotationUpdate, async (event, relative: unknown, id: unknown, update: unknown) => {
    assertTrusted(event, isTrustedSender);
    if (typeof relative !== 'string' || typeof id !== 'string' || !annotations)
      throw new Error('Invalid annotation request.');
    return annotations.update(relative, id, update as AnnotationUpdate);
  });
  ipcMain.handle(IPC_CHANNELS.vaultAnnotationDelete, async (event, relative: unknown, id: unknown) => {
    assertTrusted(event, isTrustedSender);
    if (typeof relative !== 'string' || typeof id !== 'string' || !annotations)
      throw new Error('Invalid annotation request.');
    return annotations.delete(relative, id);
  });
  ipcMain.handle(IPC_CHANNELS.vaultReadAttachment, async (event, relative: unknown) => {
    assertTrusted(event, isTrustedSender);
    if (typeof relative !== 'string') throw new Error('Invalid attachment path.');
    return readTextAttachment(requireService().resolveEntry, relative);
  });
  ipcMain.handle(IPC_CHANNELS.vaultImageAlt, async (event, relative: unknown) => {
    assertTrusted(event, isTrustedSender);
    if (typeof relative !== 'string' || !IMAGE_TYPES[path.extname(relative).toLowerCase()])
      throw new Error('Invalid image path.');
    const vault = requireService();
    await vault.resolveEntry(relative);
    const saved = await metadataFor(vault).read('image-alts.json');
    const alt = saved && typeof saved === 'object' ? (saved as Record<string, unknown>)[relative] : '';
    return typeof alt === 'string' ? alt : '';
  });
  ipcMain.handle(IPC_CHANNELS.vaultSaveImageAlt, async (event, relative: unknown, alt: unknown) => {
    assertTrusted(event, isTrustedSender);
    if (
      typeof relative !== 'string' ||
      !IMAGE_TYPES[path.extname(relative).toLowerCase()] ||
      typeof alt !== 'string' ||
      alt.length > 2000
    )
      throw new Error('Invalid image description.');
    const vault = requireService();
    await vault.resolveEntry(relative);
    const store = metadataFor(vault);
    const saved = await store.read('image-alts.json');
    await store.write('image-alts.json', {
      ...(saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {}),
      [relative]: alt,
    });
  });
  ipcMain.handle(IPC_CHANNELS.settingsGet, async (event) => {
    assertTrusted(event, isTrustedSender);
    const vault = service;
    if (vault) {
      const saved = await metadataFor(vault).read('settings.json');
      if (saved) return validateSettings(saved);
    }
    try {
      return validateSettings(JSON.parse(await readFile(path.join(app.getPath('userData'), 'settings.json'), 'utf8')));
    } catch {
      return { ...DEFAULT_SETTINGS, shortcuts: {} };
    }
  });
  ipcMain.handle(IPC_CHANNELS.settingsSave, async (event, value: unknown) => {
    assertTrusted(event, isTrustedSender);
    const settings = validateSettings(value);
    if (service) await metadataFor(service).write('settings.json', settings);
    await mkdir(app.getPath('userData'), { recursive: true });
    await writeFile(path.join(app.getPath('userData'), 'settings.json'), JSON.stringify(settings, null, 2), {
      mode: 0o600,
    });
  });
  ipcMain.handle(IPC_CHANNELS.vaultReveal, async (event, relativePath: unknown) => {
    assertTrusted(event, isTrustedSender);
    if (typeof relativePath !== 'string') throw new Error('Path must be text.');
    shell.showItemInFolder(await requireService().resolveEntry(relativePath));
  });
  ipcMain.handle(IPC_CHANNELS.vaultOpenExternal, async (event, relativePath: unknown) => {
    assertTrusted(event, isTrustedSender);
    if (typeof relativePath !== 'string') throw new Error('Path must be text.');
    const error = await shell.openPath(await requireService().resolveEntry(relativePath));
    if (error) throw new Error(error);
  });
  ipcMain.handle(IPC_CHANNELS.vaultImport, async (event, notebookPath: unknown) => {
    assertTrusted(event, isTrustedSender);
    if (typeof notebookPath !== 'string') throw new Error('Notebook path must be text.');
    const vault = requireService();
    await vault.resolveEntry(notebookPath);
    const result = await dialog.showOpenDialog({ properties: ['openFile'] });
    if (result.canceled || !result.filePaths[0]) return null;
    const source = result.filePaths[0];
    const destination = await vault.resolveEntry(path.posix.join(notebookPath, path.basename(source)), true);
    await copyFile(source, destination, 1);
    await vault.refreshSearchIndex();
    return vault.getVault();
  });
  ipcMain.handle(IPC_CHANNELS.vaultDelete, async (event, relativePath: unknown) => {
    assertTrusted(event, isTrustedSender);
    if (typeof relativePath !== 'string') throw new Error('Path must be text.');
    const vault = requireService();
    const target = await vault.resolveEntry(relativePath);
    if (target === vaultPathOf(await vault.getVault())) throw new Error('The vault itself cannot be deleted here.');
    const answer = await dialog.showMessageBox({
      type: 'warning',
      title: 'Delete item',
      message: `Move “${path.basename(target)}” to the Recycle Bin?`,
      buttons: ['Cancel', 'Delete'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (answer.response !== 1) return vault.getVault();
    await shell.trashItem(target);
    await vault.refreshSearchIndex();
    return vault.getVault();
  });
  ipcMain.handle(IPC_CHANNELS.vaultGetTasks, async (event) => {
    assertTrusted(event, isTrustedSender);
    return requireService().getTasks();
  });
  ipcMain.handle(
    IPC_CHANNELS.vaultToggleTask,
    async (event, relativePath: unknown, line: unknown, complete: unknown) => {
      assertTrusted(event, isTrustedSender);
      if (typeof relativePath !== 'string' || typeof line !== 'number' || typeof complete !== 'boolean') {
        throw new Error('Invalid task update request.');
      }
      return requireService().toggleTask(relativePath, line, complete);
    },
  );
  ipcMain.handle(IPC_CHANNELS.vaultGetLinkIndex, async (event) => {
    assertTrusted(event, isTrustedSender);
    return requireService().getLinkIndex();
  });
  ipcMain.handle(IPC_CHANNELS.vaultGetBookmarks, async (event) => {
    assertTrusted(event, isTrustedSender);
    return requireService().getBookmarks();
  });
  ipcMain.handle(IPC_CHANNELS.vaultToggleBookmark, async (event, relativePath: unknown) => {
    assertTrusted(event, isTrustedSender);
    if (typeof relativePath !== 'string') throw new Error('Bookmark path must be text.');
    return requireService().toggleBookmark(relativePath);
  });
}

function vaultPathOf(vault: { path: string }) {
  return vault.path;
}
