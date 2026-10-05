// Owns the narrow, validated IPC boundary for local vault filesystem operations.
import { copyFile, lstat, mkdir, readFile, realpath, rm, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { app, dialog, ipcMain, Notification, protocol, shell, type IpcMainInvokeEvent } from 'electron';
import { IPC_CHANNELS } from '../../src/shared/ipc';
import { createVaultService } from './service';
import { createAnnotationStore } from './annotations';
import { createMetadataStore } from './metadata';
import { DOCUMENT_TYPES, IMAGE_TYPES, protocolPath, readTextAttachment } from './attachments';
import { readDocumentAttachment } from './document-preview';
import { captureWebPage } from './web-capture';
import { sanitizeHtmlFragment, standaloneHtml } from './html-sanitize';
import { planLinkRepair, type NoteSource } from './link-repair';
import { DEFAULT_SETTINGS, validateSettings } from '../../src/shared/settings';
import type { VaultChangedEvent } from '../../src/shared/search';
import type { NewAnnotation, AnnotationUpdate } from '../../src/shared/annotations';
import type { NewPdfAnnotation, PdfAnnotationUpdate } from '../../src/shared/pdf-annotation';
import type { VaultEntry, VaultInfo } from '../../src/shared/types';
import { createReminderService } from './reminders';
import type { CreateReminderInput, VaultReminderEvent, SnoozeDuration } from '../../src/shared/reminders';
import { createAssetStore } from './assets';
import {
  createVaultSecurityConfig,
  completeRecoverableCredentialMigration,
  decryptPasswordEncryptedNote,
  decryptRecord,
  encryptRecord,
  isEncryptedRecord,
  isPasswordEncryptedNote,
  encryptNoteWithPassword,
  generateVaultRecoveryKey,
  prepareVaultRecovery,
  reencryptPasswordNote,
  resetVaultPasswordWithRecovery,
  revokeVaultRecoveryKey,
  rotateVaultRecoveryKey,
  updateRecoverableCredentials,
  updateRecoverableCredentialText,
  unwrapLegacyVaultKey,
  unlockPasswordEncryptedNote,
  unlockVault,
  type VaultSecurityConfig,
} from './security';

type TrustedSender = (event: IpcMainInvokeEvent) => boolean;
type VaultService = ReturnType<typeof createVaultService>;

const recentFile = () => path.join(app.getPath('userData'), 'recent-vault.json');
let service: VaultService | null = null;
let metadata: ReturnType<typeof createMetadataStore> | null = null;
let annotations: ReturnType<typeof createAnnotationStore> | null = null;
let sendChanged: (event: VaultChangedEvent) => void = () => undefined;
let reminderService: ReturnType<typeof createReminderService> | null = null;
let assets: ReturnType<typeof createAssetStore> | null = null;
let securityConfig: VaultSecurityConfig | null = null;
let masterKey: Buffer | null = null;
const noteKeys = new Map<string, Buffer>();
let pendingRecovery: { config: VaultSecurityConfig; key: Buffer | null; vault: VaultService } | null = null;
let idleLockTimer: NodeJS.Timeout | undefined;
let idleLockMinutes = 15;
let sendSecurityLocked: () => void = () => undefined;
let sendReminder: (event: VaultReminderEvent) => void = () => undefined;
const notifications = new Set<Notification>();
const notificationTargets = new Map<Notification, { path: string }>();
let vaultOperations: Promise<unknown> = Promise.resolve();

function serializeVaultOperation<T>(operation: () => Promise<T>): Promise<T> {
  const result = vaultOperations.then(operation, operation);
  vaultOperations = result.catch(() => undefined);
  return result;
}

async function prepareHtmlExport(content: string, notePath: string, vault: VaultService) {
  let omittedImages = 0;
  let fragment = sanitizeHtmlFragment(content, { allowVaultImages: true });
  const imageTag = /<img\b[^>]*>/gi;
  const replacements: Array<{ source: string; replacement: string }> = [];
  for (const match of fragment.matchAll(imageTag)) {
    const tag = match[0];
    const sourceAttribute = /\bsrc="([^"]*)"/i.exec(tag);
    if (!sourceAttribute) continue;
    const source = sourceAttribute[1];
    if (/^data:image\//i.test(source)) continue;
    try {
      let relative: string;
      if (/^vault-file:\/\/attachment\//i.test(source)) {
        relative = protocolPath(source);
      } else {
        if (/^(?:[a-z][a-z\d+.-]*:|\/\/|\/)/i.test(source) || source.includes('\\'))
          throw new Error('Unsafe image path.');
        const decoded = decodeURIComponent(source.split(/[?#]/, 1)[0]);
        relative = path.posix.normalize(path.posix.join(path.posix.dirname(notePath), decoded));
        if (relative === '..' || relative.startsWith('../') || path.posix.isAbsolute(relative))
          throw new Error('Image path leaves the vault.');
      }
      if (!IMAGE_TYPES[path.extname(relative).toLowerCase()]) throw new Error('Unsupported image type.');
      const absolute = await vault.resolveEntry(relative);
      const stat = await lstat(absolute);
      if (!stat.isFile() || stat.size > 20 * 1024 * 1024) throw new Error('Unsupported image size.');
      const bytes = await readFile(absolute);
      const dataUri = `data:${IMAGE_TYPES[path.extname(relative).toLowerCase()]};base64,${bytes.toString('base64')}`;
      replacements.push({
        source: tag,
        replacement: tag.replace(sourceAttribute[0], `src="${dataUri}"`),
      });
    } catch {
      omittedImages += 1;
      replacements.push({ source: tag, replacement: tag.replace(sourceAttribute[0], 'src=""') });
    }
  }
  for (const replacement of replacements) fragment = fragment.replace(replacement.source, replacement.replacement);
  fragment = sanitizeHtmlFragment(fragment, { renderTaskControls: true });
  return {
    html: standaloneHtml(path.basename(notePath, path.extname(notePath)), fragment),
    omittedImages,
  };
}

function assertTrusted(event: IpcMainInvokeEvent, isTrustedSender: TrustedSender, allowLocked = false) {
  if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender.');
  if (!allowLocked && securityConfig && !masterKey) throw new Error('Unlock the vault before accessing its contents.');
  if (!allowLocked) resetIdleLock();
}

function lockVault() {
  if (idleLockTimer) clearTimeout(idleLockTimer);
  idleLockTimer = undefined;
  const wasUnlocked = masterKey !== null;
  masterKey?.fill(0);
  masterKey = null;
  for (const key of noteKeys.values()) key.fill(0);
  noteKeys.clear();
  pendingRecovery?.key?.fill(0);
  pendingRecovery = null;
  if (wasUnlocked) {
    reminderService?.stop();
    reminderService = null;
    for (const notification of notifications) notification.close();
    notifications.clear();
    notificationTargets.clear();
    sendSecurityLocked();
  }
}

function resetIdleLock() {
  if (idleLockTimer) clearTimeout(idleLockTimer);
  if (!masterKey) return;
  if (idleLockMinutes === 0) return;
  idleLockTimer = setTimeout(lockVault, idleLockMinutes * 60 * 1000);
  idleLockTimer.unref();
}

function presentVault(vault: VaultInfo): VaultInfo {
  return securityConfig && !masterKey ? { ...vault, entries: [] } : vault;
}

function requireService() {
  if (!service) throw new Error('Open a vault first.');
  return service;
}

async function rememberVault(vaultPath: string) {
  await mkdir(path.dirname(recentFile()), { recursive: true });
  await writeFile(recentFile(), JSON.stringify({ lastOpened: vaultPath }), 'utf8');
}

async function removeLegacyCredentialCopy(vault: VaultService) {
  const credentialPath = await vault.resolveMetadata('credentials.json', true);
  await unlink(credentialPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
  });
}

async function readVaultSecurityMetadata(vault: VaultService): Promise<unknown> {
  const filename = await vault.resolveMetadata('security.json', true);
  const stat = await lstat(filename).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!stat) return null;
  if (!stat.isFile() || stat.size > 2 * 1024 * 1024 + 16 * 1024)
    throw new Error('Vault security metadata exceeds the allowed size.');
  return JSON.parse(await readFile(filename, 'utf8')) as unknown;
}

function openVault(vaultPath: string) {
  return serializeVaultOperation(() => openVaultNow(vaultPath));
}

async function startReminders(vaultService: VaultService, vault: VaultInfo) {
  const nextReminders = makeReminders(vaultService, vault);
  reminderService = nextReminders;
  await nextReminders.initialize().catch(() =>
    sendReminder({
      type: 'error',
      vaultPath: vault.path,
      message: 'Could not initialize reminders. Check vault metadata.',
    }),
  );
}

async function openVaultNow(vaultPath: string) {
  const nextService = createVaultService(vaultPath);
  let vault: VaultInfo;
  let nextSecurity: VaultSecurityConfig | null = null;
  try {
    vault = await nextService.initialize();
    const savedSecurity = await readVaultSecurityMetadata(nextService);
    const savedSettings = await createMetadataStore(nextService).read('settings.json');
    if (savedSettings) {
      try {
        idleLockMinutes = validateSettings(savedSettings).vaultLockMinutes ?? 15;
      } catch {
        idleLockMinutes = 15;
      }
    } else {
      idleLockMinutes = 15;
    }
    if (savedSecurity && typeof savedSecurity === 'object' && !Array.isArray(savedSecurity)) {
      nextSecurity = savedSecurity as VaultSecurityConfig;
    }
    await rememberVault(vault.path);
  } catch (error) {
    await nextService.dispose().catch(() => undefined);
    throw error;
  }
  reminderService?.stop();
  for (const notification of notifications) notification.close();
  notifications.clear();
  notificationTargets.clear();
  lockVault();
  await service?.dispose().catch(() => undefined);
  service = nextService;
  securityConfig = nextSecurity;
  metadata = createMetadataStore(nextService);
  assets = createAssetStore(nextService, metadata);
  annotations = createAnnotationStore({
    read: () => {
      if (securityConfig && !masterKey) throw new Error('Unlock the vault before accessing its contents.');
      return metadataFor(nextService).read('annotations.json');
    },
    write: (value) => {
      if (securityConfig && !masterKey) throw new Error('Unlock the vault before accessing its contents.');
      return metadataFor(nextService).write('annotations.json', value);
    },
    validateNote: async (relative) => {
      await nextService.resolveEntry(relative);
    },
    validatePdf: (relative) => nextService.validatePdfAnnotationDocument(relative),
  });
  if (masterKey || !securityConfig) await startReminders(nextService, vault);
  else reminderService = null;
  await nextService
    .startWatcher(
      (event) => {
        sendChanged(event);
        if (service === nextService) void reminderService?.refresh().catch(() => undefined);
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
  return presentVault(vault);
}

function makeReminders(nextService: VaultService, vault: VaultInfo) {
  return createReminderService({
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
        const target = { path: reminder.path };
        notificationTargets.set(notification, target);
        notifications.add(notification);
        notification.on('click', () => {
          if (service === nextService)
            sendReminder({ type: 'open', vaultPath: vault.path, reminder: { ...reminder, path: target.path } });
        });
        notification.on('close', () => {
          notifications.delete(notification);
          notificationTargets.delete(notification);
        });
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
}

function metadataFor(vault: VaultService) {
  if (vault !== service || !metadata) throw new Error('The open vault has changed. Retry the operation.');
  return metadata;
}

async function finishLegacyCredentialCleanup(vault: VaultService, key: Buffer) {
  if (securityConfig?.version !== 3 || !securityConfig.legacyCredentialsCleanupRequired) return;
  try {
    await removeLegacyCredentialCopy(vault);
    const completed = completeRecoverableCredentialMigration(securityConfig, key);
    await metadataFor(vault).write('security.json', completed);
    securityConfig = completed;
  } catch {
    lockVault();
    throw new Error('Could not finish credential migration cleanup. The vault remains locked.');
  }
}

function readVaultEncryptedNote(record: ReturnType<typeof encryptRecord>) {
  if (!masterKey) throw new Error('Unlock the vault before opening this encrypted note.');
  try {
    return decryptRecord(masterKey, 'note', record);
  } catch (error) {
    if (securityConfig?.version !== 3) throw error;
    const legacyKey = unwrapLegacyVaultKey(securityConfig, masterKey);
    if (!legacyKey) throw error;
    try {
      return decryptRecord(legacyKey, 'note', record);
    } finally {
      legacyKey.fill(0);
    }
  }
}

async function relocate(relative: string, destination: string) {
  if (relative === destination || relative.includes('\\') || destination.includes('\\'))
    throw new Error('Choose a different, vault-relative destination using forward slashes.');
  const vault = requireService();
  const currentAnnotations = annotations;
  const currentReminders = reminderService;
  const sourceStat = await lstat(await vault.resolveEntry(relative));
  await vault.resolveEntry(destination, true);
  const sourceExtension = path.posix.extname(relative).toLowerCase();
  const destinationExtension = path.posix.extname(destination).toLowerCase();
  if (['.md', '.html'].includes(sourceExtension) && sourceExtension !== destinationExtension)
    throw new Error('Use the note format conversion command to change a note extension.');
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
  const bookmarksSnapshot = await store.read('bookmarks.json');
  let reminderSnapshot: unknown = null;
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
    await store.write('bookmarks.json', bookmarksSnapshot).catch(() => undefined);
  };
  const operation = async () => {
    try {
      metadataFor(vault);
      reminderSnapshot = await store.read('reminders.json');
      try {
        await vault.moveEntry(relative, destination);
        moved = true;
      } catch (error) {
        // Index/metadata updates may fail after the filesystem rename has committed.
        try {
          const targetStat = await lstat(await vault.resolveEntry(destination));
          const sourceMissing = await lstat(await vault.resolveEntry(relative, true)).then(
            () => false,
            (failure: NodeJS.ErrnoException) => failure.code === 'ENOENT',
          );
          moved = sourceMissing && targetStat.dev === sourceStat.dev && targetStat.ino === sourceStat.ino;
        } catch {
          /* The move did not commit. */
        }
        throw error;
      }
      for (const item of repairs) {
        written.push(item);
        await vault.saveNote(item.nextPath, item.after, item.before);
      }
      await currentAnnotations?.migratePaths(relative, destination);
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
    const result = currentReminders
      ? await currentReminders.withPathMigration(relative, destination, operation)
      : await operation();
    for (const target of notificationTargets.values()) {
      if (target.path === relative || target.path.startsWith(`${relative}/`))
        target.path = destination + target.path.slice(relative.length);
    }
    return result;
  } catch (error) {
    await rollback();
    if (moved && currentReminders && service === vault) {
      currentReminders.stop();
      const vaultInfo = await vault.getVault();
      reminderService = makeReminders(vault, vaultInfo);
      await reminderService.initialize().catch(() =>
        sendReminder({
          type: 'error',
          vaultPath: vaultInfo.path,
          message: 'Could not restart reminders after a failed move. Reopen the vault.',
        }),
      );
    }
    throw error;
  }
}

/** Register fixed handlers; every operation checks the top-level trusted renderer. */
export function setupVaultIpc(
  isTrustedSender: TrustedSender,
  onChanged: (event: VaultChangedEvent) => void,
  onReminder: (event: VaultReminderEvent) => void,
  onSecurityLocked: () => void = () => undefined,
) {
  sendChanged = onChanged;
  sendReminder = onReminder;
  sendSecurityLocked = onSecurityLocked;
  ipcMain.handle(IPC_CHANNELS.vaultSecurityStatus, async (event) => {
    assertTrusted(event, isTrustedSender, true);
    resetIdleLock();
    return {
      enabled: securityConfig !== null,
      locked: securityConfig !== null && masterKey === null,
      recoveryAvailable:
        (securityConfig?.version === 2 && Boolean(securityConfig.recovery)) ||
        (securityConfig?.version === 3 && securityConfig.recoveryWrappedDataKey !== null),
    };
  });
  ipcMain.handle(IPC_CHANNELS.vaultSecuritySetup, async (event, password: unknown) => {
    assertTrusted(event, isTrustedSender);
    return serializeVaultOperation(async () => {
      if (securityConfig) throw new Error('Vault password protection is already configured.');
      if (typeof password !== 'string') throw new Error('Invalid vault password.');
      const { config, key } = await createVaultSecurityConfig(password);
      try {
        await metadataFor(requireService()).write('security.json', config);
      } catch (error) {
        key.fill(0);
        throw error;
      }
      securityConfig = config;
      masterKey = key;
      resetIdleLock();
    });
  });
  ipcMain.handle(IPC_CHANNELS.vaultSecurityUnlock, async (event, password: unknown) => {
    assertTrusted(event, isTrustedSender, true);
    return serializeVaultOperation(async () => {
      if (!securityConfig || typeof password !== 'string')
        throw new Error('Vault password protection is not configured.');
      const key = await unlockVault(securityConfig, password);
      masterKey?.fill(0);
      masterKey = key;
      await finishLegacyCredentialCleanup(requireService(), key);
      resetIdleLock();
      const vault = await requireService().getVault();
      await startReminders(requireService(), vault);
      return vault;
    });
  });
  ipcMain.handle(IPC_CHANNELS.vaultSecurityLock, async (event) => {
    assertTrusted(event, isTrustedSender, true);
    return serializeVaultOperation(async () => {
      if (!securityConfig) throw new Error('Vault password protection is not configured.');
      lockVault();
    });
  });
  ipcMain.handle(IPC_CHANNELS.vaultSecurityPrepareRecovery, async (event, password: unknown) => {
    assertTrusted(event, isTrustedSender);
    return serializeVaultOperation(async () => {
      if (!securityConfig || !masterKey || typeof password !== 'string')
        throw new Error('Unlock the vault and confirm its password before changing recovery.');
      pendingRecovery?.key?.fill(0);
      pendingRecovery = null;
      const recoveryKey = generateVaultRecoveryKey();
      if (securityConfig.version !== 3) {
        const savedCredentials = await metadataFor(requireService()).read('credentials.json');
        const credentials = savedCredentials ? decryptRecord(masterKey, 'credentials', savedCredentials) : null;
        const prepared = await prepareVaultRecovery(securityConfig, password, recoveryKey, credentials);
        pendingRecovery = { config: prepared.config, key: prepared.key, vault: requireService() };
      } else {
        const authenticatedKey = await unlockVault(securityConfig, password);
        try {
          if (!authenticatedKey.equals(masterKey)) throw new Error('Incorrect vault password.');
        } finally {
          authenticatedKey.fill(0);
        }
        pendingRecovery = {
          config: rotateVaultRecoveryKey(securityConfig, masterKey, recoveryKey),
          key: null,
          vault: requireService(),
        };
      }
      return recoveryKey;
    });
  });
  ipcMain.handle(IPC_CHANNELS.vaultSecurityAcknowledgeRecovery, async (event, acknowledged: unknown) => {
    assertTrusted(event, isTrustedSender);
    return serializeVaultOperation(async () => {
      const pending = pendingRecovery;
      if (acknowledged === false) {
        if (pending?.vault === service) {
          pending.key?.fill(0);
          pendingRecovery = null;
        }
        return;
      }
      if (acknowledged !== true || !pending || pending.vault !== requireService() || !masterKey)
        throw new Error('Save the recovery key before confirming recovery setup.');
      const storedCredentials =
        securityConfig?.version === 3
          ? securityConfig.credentials
          : await metadataFor(pending.vault).read('credentials.json');
      const credentialsText = storedCredentials ? decryptRecord(masterKey, 'credentials', storedCredentials) : null;
      const dataKey = pending.key ?? masterKey;
      const committedConfig = updateRecoverableCredentialText(pending.config, dataKey, credentialsText);
      await metadataFor(pending.vault).write('security.json', committedConfig);
      const previousKey = masterKey;
      securityConfig = committedConfig;
      if (pending.key) masterKey = pending.key;
      if (pending.key && previousKey !== pending.key) previousKey.fill(0);
      pendingRecovery = null;
      if (committedConfig.legacyCredentialsCleanupRequired) {
        try {
          await removeLegacyCredentialCopy(pending.vault);
          const completed = completeRecoverableCredentialMigration(committedConfig, masterKey);
          await metadataFor(pending.vault).write('security.json', completed);
          securityConfig = completed;
        } catch {
          lockVault();
          throw new Error(
            'Recovery was committed, but old credential cleanup is incomplete. Reopen the vault to retry.',
          );
        }
      }
      resetIdleLock();
    });
  });
  ipcMain.handle(IPC_CHANNELS.vaultSecurityRecover, async (event, recoveryKey: unknown, newPassword: unknown) => {
    assertTrusted(event, isTrustedSender, true);
    return serializeVaultOperation(async () => {
      if (
        !securityConfig ||
        ![2, 3].includes(securityConfig.version) ||
        masterKey ||
        typeof recoveryKey !== 'string' ||
        typeof newPassword !== 'string'
      )
        throw new Error('Vault recovery is unavailable or the recovery request is invalid.');
      const recovered = await resetVaultPasswordWithRecovery(securityConfig, recoveryKey, newPassword);
      try {
        await metadataFor(requireService()).write('security.json', recovered.config);
      } catch (error) {
        recovered.key.fill(0);
        throw error;
      }
      securityConfig = recovered.config;
      masterKey = recovered.key;
      await finishLegacyCredentialCleanup(requireService(), recovered.key);
      resetIdleLock();
      const vault = await requireService().getVault();
      await startReminders(requireService(), vault);
      return vault;
    });
  });
  ipcMain.handle(IPC_CHANNELS.vaultSecurityRevokeRecovery, async (event, password: unknown) => {
    assertTrusted(event, isTrustedSender);
    return serializeVaultOperation(async () => {
      if (!securityConfig || ![2, 3].includes(securityConfig.version) || !masterKey || typeof password !== 'string')
        throw new Error('Vault recovery is not configured.');
      const authenticatedKey = await unlockVault(securityConfig, password);
      try {
        if (!authenticatedKey.equals(masterKey)) throw new Error('Incorrect vault password.');
      } finally {
        authenticatedKey.fill(0);
      }
      const revoked =
        securityConfig.version === 3
          ? rotateVaultRecoveryKey(securityConfig, masterKey, null)
          : revokeVaultRecoveryKey(securityConfig);
      await metadataFor(requireService()).write('security.json', revoked);
      securityConfig = revoked;
      resetIdleLock();
    });
  });
  ipcMain.handle(
    IPC_CHANNELS.vaultNoteEncrypt,
    async (event, relative: unknown, expected: unknown, password: unknown) => {
      assertTrusted(event, isTrustedSender);
      if (typeof relative !== 'string' || typeof expected !== 'string' || typeof password !== 'string' || !masterKey)
        throw new Error('Invalid note encryption request.');
      const vault = requireService();
      const existing = await vault.readNote(relative);
      if (existing !== expected) throw new Error('Note changed on disk. Resolve the conflict before encrypting.');
      let parsed: unknown;
      try {
        parsed = JSON.parse(existing);
      } catch {
        parsed = null;
      }
      if (isEncryptedRecord(parsed) || isPasswordEncryptedNote(parsed))
        throw new Error('This note is already encrypted.');
      const encrypted = await encryptNoteWithPassword(password, existing, randomUUID());
      try {
        await vault.saveNote(relative, JSON.stringify(encrypted.record), existing);
        noteKeys.get(encrypted.record.id)?.fill(0);
        noteKeys.set(encrypted.record.id, encrypted.key);
      } catch (error) {
        encrypted.key.fill(0);
        throw error;
      }
      resetIdleLock();
    },
  );
  ipcMain.handle(IPC_CHANNELS.vaultNoteEncryptionStatus, async (event, relative: unknown) => {
    assertTrusted(event, isTrustedSender);
    if (typeof relative !== 'string') throw new Error('Invalid note path.');
    const content = await requireService().readNote(relative);
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      return false;
    }
    return isEncryptedRecord(parsed) || isPasswordEncryptedNote(parsed);
  });
  ipcMain.handle(IPC_CHANNELS.vaultCredentialsRead, async (event) => {
    assertTrusted(event, isTrustedSender);
    if (!masterKey) throw new Error('Unlock the vault first.');
    const saved =
      securityConfig?.version === 3
        ? securityConfig.credentials
        : await metadataFor(requireService()).read('credentials.json');
    if (!saved) return [];
    const content = decryptRecord(masterKey, 'credentials', saved);
    const parsed: unknown = JSON.parse(content);
    if (!Array.isArray(parsed)) throw new Error('Credential store is damaged.');
    return parsed.map((item) => {
      if (
        !item ||
        typeof item !== 'object' ||
        typeof item.id !== 'string' ||
        typeof item.username !== 'string' ||
        typeof item.password !== 'string'
      )
        throw new Error('Credential store is damaged.');
      return { id: item.id, username: item.username, password: item.password };
    });
  });
  ipcMain.handle(
    IPC_CHANNELS.vaultCredentialsSave,
    async (event, id: unknown, username: unknown, password: unknown) => {
      assertTrusted(event, isTrustedSender);
      return serializeVaultOperation(async () => {
        if (
          !masterKey ||
          typeof id !== 'string' ||
          !id.trim() ||
          id.length > 120 ||
          typeof username !== 'string' ||
          username.length > 500 ||
          typeof password !== 'string' ||
          password.length > 4096
        )
          throw new Error('Invalid credential.');
        const saved =
          securityConfig?.version === 3
            ? securityConfig.credentials
            : await metadataFor(requireService()).read('credentials.json');
        const credentials = saved
          ? (JSON.parse(decryptRecord(masterKey, 'credentials', saved)) as {
              id: string;
              username: string;
              password: string;
            }[])
          : [];
        const normalizedId = id.trim();
        const next = credentials.filter((item) => item.id !== normalizedId);
        next.push({ id: normalizedId, username, password });
        const encrypted = encryptRecord(masterKey, 'credentials', 'credentials-store', JSON.stringify(next));
        if (securityConfig?.version === 3) {
          const updated = updateRecoverableCredentials(securityConfig, masterKey, next);
          await metadataFor(requireService()).write('security.json', updated);
          securityConfig = updated;
        } else {
          await metadataFor(requireService()).write('credentials.json', encrypted);
        }
        resetIdleLock();
      });
    },
  );
  ipcMain.handle(IPC_CHANNELS.vaultCredentialsDelete, async (event, id: unknown) => {
    assertTrusted(event, isTrustedSender);
    return serializeVaultOperation(async () => {
      if (!masterKey || typeof id !== 'string' || id.length > 120) throw new Error('Invalid credential.');
      const saved =
        securityConfig?.version === 3
          ? securityConfig.credentials
          : await metadataFor(requireService()).read('credentials.json');
      if (!saved) return;
      const credentials = JSON.parse(decryptRecord(masterKey, 'credentials', saved)) as { id: string }[];
      const encrypted = encryptRecord(
        masterKey,
        'credentials',
        'credentials-store',
        JSON.stringify(credentials.filter((item) => item.id !== id)),
      );
      if (securityConfig?.version === 3) {
        const updated = updateRecoverableCredentials(
          securityConfig,
          masterKey,
          credentials.filter((item) => item.id !== id),
        );
        await metadataFor(requireService()).write('security.json', updated);
        securityConfig = updated;
      } else {
        await metadataFor(requireService()).write('credentials.json', encrypted);
      }
      resetIdleLock();
    });
  });
  ipcMain.handle(IPC_CHANNELS.vaultCaptureWeb, async (event, url: unknown, notebookPath: unknown, format: unknown) => {
    assertTrusted(event, isTrustedSender);
    if (
      typeof url !== 'string' ||
      typeof notebookPath !== 'string' ||
      notebookPath.length > 2048 ||
      !['markdown', 'html'].includes(String(format))
    ) {
      throw new Error('Invalid web capture request.');
    }
    const vault = requireService();
    const root = (await vault.getVault()).path;
    const notebook = notebookPath ? await vault.resolveEntry(notebookPath) : root;
    if (!(await lstat(notebook)).isDirectory()) throw new Error('Choose a notebook folder for the capture.');
    const captureId = randomUUID();
    const captureFolder = path.posix.join(notebookPath, 'Attachments', `Capture-${captureId}`);
    const noteDirectory = notebookPath ? `${notebookPath}/` : '';
    let attachmentFolder: string | undefined;
    let noteCreated = false;
    try {
      const capture = await captureWebPage(url, `Attachments/Capture-${captureId}/`);
      attachmentFolder = await vault.resolveEntry(captureFolder, true);
      await mkdir(attachmentFolder, { recursive: true });
      for (const [index, image] of capture.images.entries()) {
        const imagePath = path.posix.join(captureFolder, `image-${index + 1}${image.extension}`);
        await writeFile(await vault.resolveEntry(imagePath, true), image.bytes, { flag: 'wx', mode: 0o600 });
      }
      const safeTitle =
        [...capture.title]
          .filter(
            (character) =>
              character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127 && !'<>:"/\\|?*'.includes(character),
          )
          .join('')
          .replace(/[. ]+$/g, '')
          .trim()
          .slice(0, 100) || 'Web capture';
      const extension = format === 'html' ? '.html' : '.md';
      const notePath = `${noteDirectory}${safeTitle}-${captureId.slice(0, 8)}${extension}`;
      const content =
        format === 'html' ? capture.html : `# ${safeTitle}\n\nSource: ${capture.sourceUrl}\n\n${capture.markdown}\n`;
      await vault.createNote(notePath, content);
      noteCreated = true;
      return { vault: await vault.getVault(), notePath, omittedImages: capture.omittedImages };
    } catch (error) {
      if (attachmentFolder && !noteCreated)
        await rm(attachmentFolder, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  });
  ipcMain.handle(
    IPC_CHANNELS.vaultExportNote,
    async (event, relativePath: unknown, format: unknown, content: unknown, protectedConsent: unknown) => {
      assertTrusted(event, isTrustedSender);
      if (
        typeof relativePath !== 'string' ||
        typeof format !== 'string' ||
        !['html', 'markdown'].includes(format) ||
        typeof content !== 'string' ||
        Buffer.byteLength(content, 'utf8') > 8 * 1024 * 1024 ||
        typeof protectedConsent !== 'boolean'
      ) {
        throw new Error('Invalid note export request.');
      }
      const vault = requireService();
      const sourcePath = await vault.resolveEntry(relativePath);
      if (!['.md', '.html'].includes(path.extname(sourcePath).toLowerCase())) {
        throw new Error('Only Markdown and HTML notes can be exported.');
      }
      let stored: unknown;
      try {
        stored = JSON.parse(await vault.readNote(relativePath));
      } catch {
        stored = null;
      }
      let protectedNote = false;
      if (isPasswordEncryptedNote(stored)) {
        protectedNote = true;
        const key = noteKeys.get(stored.id);
        if (!key) throw new Error('Unlock this note with its password before exporting.');
        decryptPasswordEncryptedNote(key, stored);
      } else if (isEncryptedRecord(stored)) {
        protectedNote = true;
        if (!masterKey) throw new Error('Unlock the vault before exporting this note.');
        decryptRecord(masterKey, 'note', stored);
      }
      if (protectedNote && !protectedConsent) {
        throw new Error('Explicit consent is required before exporting protected note content.');
      }
      const extension = format === 'html' ? '.html' : '.md';
      const basename = path.basename(relativePath, path.extname(relativePath));
      const result = await dialog.showSaveDialog({
        title: `Export ${basename}`,
        defaultPath: `${basename}${extension}`,
        filters: [
          { name: format === 'html' ? 'HTML document' : 'Markdown document', extensions: [extension.slice(1)] },
        ],
        properties: ['showOverwriteConfirmation'],
      });
      if (result.canceled || !result.filePath) return { cancelled: true, omittedImages: 0 };
      const destination = await realpath(result.filePath).catch(() => path.resolve(result.filePath));
      if (destination === path.resolve(sourcePath)) {
        throw new Error('Choose a different location so the original note is not overwritten.');
      }
      if (path.extname(result.filePath).toLowerCase() !== extension) {
        throw new Error(`Choose a ${extension} filename for this export.`);
      }
      let exported = content;
      let omittedImages = 0;
      if (format === 'html') {
        const prepared = await prepareHtmlExport(content, relativePath, vault);
        exported = prepared.html;
        omittedImages = prepared.omittedImages;
      }
      await writeFile(destination, exported, { encoding: 'utf8', mode: 0o600 });
      return { cancelled: false, omittedImages };
    },
  );
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
    lockVault();
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
      if (securityConfig && !masterKey) return new Response('Vault is locked.', { status: 423 });
      const relative = protocolPath(request.url);
      const extension = path.extname(relative).toLowerCase();
      const mime = IMAGE_TYPES[extension] ?? DOCUMENT_TYPES[extension];
      if (!mime) return new Response('Unsupported preview.', { status: 415 });
      const target = await requireService().resolveEntry(relative);
      const stat = await lstat(target);
      if (!stat.isFile() || stat.size > 40 * 1024 * 1024) return new Response('Attachment too large.', { status: 413 });
      const bytes = await readFile(target);
      return new Response(new Uint8Array(bytes), {
        headers: { 'Content-Type': mime, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' },
      });
    } catch {
      return new Response('Attachment not available.', { status: 404 });
    }
  });
  ipcMain.handle(IPC_CHANNELS.vaultOpen, async (event) => {
    assertTrusted(event, isTrustedSender, true);
    const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
    return result.canceled || !result.filePaths[0] ? null : openVault(result.filePaths[0]);
  });
  ipcMain.handle(IPC_CHANNELS.vaultGet, async (event) => {
    assertTrusted(event, isTrustedSender, true);
    if (service) return presentVault(await service.getVault());
    try {
      const saved = JSON.parse(await readFile(recentFile(), 'utf8')) as { lastOpened?: unknown };
      if (typeof saved.lastOpened !== 'string') return null;
      return await openVault(saved.lastOpened);
    } catch {
      return null;
    }
  });
  ipcMain.handle(IPC_CHANNELS.vaultReadNote, async (event, relativePath: unknown, password: unknown) => {
    assertTrusted(event, isTrustedSender);
    if (typeof relativePath !== 'string' || (password !== undefined && typeof password !== 'string'))
      throw new Error('Note path or password is invalid.');
    const content = await requireService().readNote(relativePath);
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      parsed = null;
    }
    if (isPasswordEncryptedNote(parsed)) {
      const cachedKey = noteKeys.get(parsed.id);
      if (cachedKey) return decryptPasswordEncryptedNote(cachedKey, parsed);
      if (typeof password !== 'string') throw new Error('Enter this note’s password to open it.');
      const unlocked = await unlockPasswordEncryptedNote(password, parsed);
      noteKeys.set(parsed.id, unlocked.key);
      resetIdleLock();
      return unlocked.plaintext;
    }
    if (!isEncryptedRecord(parsed)) return content;
    if (!masterKey) throw new Error('Unlock the vault before opening this encrypted note.');
    return readVaultEncryptedNote(parsed);
  });
  ipcMain.handle(
    IPC_CHANNELS.vaultSaveNote,
    async (event, relativePath: unknown, content: unknown, expectedContent: unknown) => {
      assertTrusted(event, isTrustedSender);
      if (typeof relativePath !== 'string' || typeof content !== 'string') throw new Error('Invalid note data.');
      if (expectedContent !== undefined && typeof expectedContent !== 'string')
        throw new Error('Invalid saved note baseline.');
      const vault = requireService();
      const onDisk = await vault.readNote(relativePath);
      let parsed: unknown;
      try {
        parsed = JSON.parse(onDisk);
      } catch {
        parsed = null;
      }
      if (isPasswordEncryptedNote(parsed)) {
        const key = noteKeys.get(parsed.id);
        if (!key) throw new Error('Unlock this note with its password before editing.');
        if (expectedContent !== undefined && decryptPasswordEncryptedNote(key, parsed) !== expectedContent)
          throw new Error('Note changed on disk. Resolve the conflict before saving.');
        await vault.saveNote(relativePath, JSON.stringify(reencryptPasswordNote(key, parsed, content)), onDisk);
      } else if (isEncryptedRecord(parsed)) {
        if (!masterKey) throw new Error('Unlock the vault before editing this encrypted note.');
        if (expectedContent !== undefined && readVaultEncryptedNote(parsed) !== expectedContent)
          throw new Error('Note changed on disk. Resolve the conflict before saving.');
        await vault.saveNote(
          relativePath,
          JSON.stringify(encryptRecord(masterKey, 'note', parsed.id, content)),
          onDisk,
        );
      } else {
        await vault.saveNote(relativePath, content, expectedContent);
      }
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
    return serializeVaultOperation(() =>
      relocate(relativePath, path.posix.join(path.posix.dirname(relativePath), name)),
    );
  });
  ipcMain.handle(IPC_CHANNELS.vaultMove, async (event, relative: unknown, destination: unknown) => {
    assertTrusted(event, isTrustedSender);
    if (typeof relative !== 'string' || typeof destination !== 'string') throw new Error('Invalid move request.');
    return serializeVaultOperation(() => relocate(relative, destination));
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
  ipcMain.handle(IPC_CHANNELS.vaultPdfAnnotations, async (event, relative: unknown) => {
    assertTrusted(event, isTrustedSender);
    if (typeof relative !== 'string' || !annotations) throw new Error('Invalid PDF annotation request.');
    const current = annotations;
    return serializeVaultOperation(() => current.pdf.list(relative));
  });
  ipcMain.handle(IPC_CHANNELS.vaultPdfAnnotationAdd, async (event, value: unknown) => {
    assertTrusted(event, isTrustedSender);
    if (!annotations) throw new Error('Open a vault first.');
    const current = annotations;
    return serializeVaultOperation(() => current.pdf.add(value as NewPdfAnnotation));
  });
  ipcMain.handle(
    IPC_CHANNELS.vaultPdfAnnotationUpdate,
    async (event, relative: unknown, id: unknown, update: unknown) => {
      assertTrusted(event, isTrustedSender);
      if (typeof relative !== 'string' || typeof id !== 'string' || !annotations)
        throw new Error('Invalid PDF annotation request.');
      const current = annotations;
      return serializeVaultOperation(() => current.pdf.update(relative, id, update as PdfAnnotationUpdate));
    },
  );
  ipcMain.handle(IPC_CHANNELS.vaultPdfAnnotationDelete, async (event, relative: unknown, id: unknown) => {
    assertTrusted(event, isTrustedSender);
    if (typeof relative !== 'string' || typeof id !== 'string' || !annotations)
      throw new Error('Invalid PDF annotation request.');
    const current = annotations;
    return serializeVaultOperation(() => current.pdf.delete(relative, id));
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
    if (/\.(?:pdf|epub)$/i.test(relative)) return readDocumentAttachment(requireService().resolveEntry, relative);
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
      if (saved) {
        const validated = validateSettings(saved);
        idleLockMinutes = validated.vaultLockMinutes ?? 15;
        return validated;
      }
    }
    try {
      const validated = validateSettings(
        JSON.parse(await readFile(path.join(app.getPath('userData'), 'settings.json'), 'utf8')),
      );
      idleLockMinutes = validated.vaultLockMinutes ?? 15;
      return validated;
    } catch {
      return { ...DEFAULT_SETTINGS, shortcuts: {} };
    }
  });
  ipcMain.handle(IPC_CHANNELS.settingsSave, async (event, value: unknown) => {
    assertTrusted(event, isTrustedSender);
    const settings = validateSettings(value);
    idleLockMinutes = settings.vaultLockMinutes ?? 15;
    if (service) await metadataFor(service).write('settings.json', settings);
    await mkdir(app.getPath('userData'), { recursive: true });
    await writeFile(path.join(app.getPath('userData'), 'settings.json'), JSON.stringify(settings, null, 2), {
      mode: 0o600,
    });
    resetIdleLock();
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
  ipcMain.handle(IPC_CHANNELS.vaultOpenUrl, async (event, rawUrl: unknown) => {
    assertTrusted(event, isTrustedSender);
    if (typeof rawUrl !== 'string') throw new Error('URL must be text.');
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new Error('Invalid external URL.');
    }
    if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) {
      throw new Error('Unsupported external URL protocol.');
    }
    await shell.openExternal(url.href);
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
    async (event, relativePath: unknown, location: unknown, complete: unknown, revision: unknown) => {
      assertTrusted(event, isTrustedSender);
      if (
        typeof relativePath !== 'string' ||
        (typeof location !== 'number' && typeof location !== 'string') ||
        typeof complete !== 'boolean' ||
        (revision !== undefined && typeof revision !== 'string')
      ) {
        throw new Error('Invalid task update request.');
      }
      return requireService().toggleTask(relativePath, location, complete, revision);
    },
  );
  ipcMain.handle(
    IPC_CHANNELS.vaultTaskDueDate,
    async (event, relativePath: unknown, taskId: unknown, dueDate: unknown, revision: unknown) => {
      assertTrusted(event, isTrustedSender);
      if (
        typeof relativePath !== 'string' ||
        typeof taskId !== 'string' ||
        typeof dueDate !== 'string' ||
        typeof revision !== 'string'
      ) {
        throw new Error('Invalid HTML task due-date request.');
      }
      return requireService().setHtmlTaskDueDate(relativePath, taskId, dueDate, revision);
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
