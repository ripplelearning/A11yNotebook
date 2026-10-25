import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  protocol,
  session,
  shell,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPOSITORY_URL } from '../src/shared/app-info';
import {
  IPC_CHANNELS,
  isMenuCommand,
  isNativeMenuState,
  type MenuCommand,
  type NativeMenuState,
} from '../src/shared/ipc';
import type { UpdaterStatus } from '../src/shared/updater';
import type { VaultReminderEvent } from '../src/shared/reminders';
import { buildApplicationMenu, updateApplicationMenu as applyNativeMenuState } from './menu';
import { setupUpdater } from './updater';
import { setupVaultIpc } from './vault/ipc';
import { getPdfReadingPreferences, setPdfReadingPreferences } from './store';
import { validatePdfReadingPreferences, type PdfReadingPreferences } from '../src/shared/pdf-reading-preferences';

const isDevelopment = !app.isPackaged;
const DEV_SERVER_URL = 'http://127.0.0.1:5173';
protocol.registerSchemesAsPrivileged([{ scheme: 'vault-file', privileges: { standard: true, secure: true } }]);

// Compiled output lives in dist-electron/electron/, the renderer build in dist/.
const rendererIndexPath = path.join(__dirname, '..', '..', 'dist', 'index.html');
const rendererIndexUrl = pathToFileURL(rendererIndexPath).href;

let mainWindow: BrowserWindow | null = null;
let shortcutCaptureActive = false;
let applicationMenu: Menu | null = null;
let nativeMenuState: NativeMenuState | null = null;
let pendingReminderAlerts: VaultReminderEvent[] = [];
const MAX_PENDING_REMINDER_ALERTS = 100;

function isAppUrl(url: string) {
  if (isDevelopment && url.startsWith(`${DEV_SERVER_URL}/`)) {
    return true;
  }
  return url.split(/[?#]/)[0] === rendererIndexUrl;
}

function isTrustedSender(event: IpcMainInvokeEvent | IpcMainEvent) {
  const frame = event.senderFrame;
  return (
    mainWindow !== null &&
    event.sender === mainWindow.webContents &&
    frame !== null &&
    frame === event.sender.mainFrame &&
    isAppUrl(frame.url)
  );
}

function isRepositoryUrl(url: string) {
  return url === REPOSITORY_URL || url.startsWith(`${REPOSITORY_URL}/`);
}

function sendToRenderer(channel: string, payload: UpdaterStatus | MenuCommand) {
  if (channel === IPC_CHANNELS.menuCommand && shortcutCaptureActive) return;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function rebuildApplicationMenu() {
  applicationMenu = buildApplicationMenu(
    (command) => {
      if (isMenuCommand(command)) sendToRenderer(IPC_CHANNELS.menuCommand, command);
    },
    isDevelopment,
    () => shortcutCaptureActive,
  );
  Menu.setApplicationMenu(applicationMenu);
  if (nativeMenuState && !shortcutCaptureActive) {
    applyNativeMenuState(applicationMenu, nativeMenuState);
  }
}

function setShortcutCaptureActive(active: boolean) {
  shortcutCaptureActive = active;
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.setIgnoreMenuShortcuts(active);
  }
  rebuildApplicationMenu();
}

export function setupShortcutCaptureIpc(
  isTrusted: (event: IpcMainEvent) => boolean,
  setActive: (active: boolean) => void,
) {
  ipcMain.on(IPC_CHANNELS.shortcutCaptureActive, (event, active: unknown) => {
    if (isTrusted(event) && typeof active === 'boolean') setActive(active);
  });
}

export function setupZoomFactorIpc(isTrusted: (event: IpcMainEvent) => boolean) {
  ipcMain.on(IPC_CHANNELS.zoomFactor, (event, factor: unknown) => {
    if (!isTrusted(event)) return;
    if (typeof factor !== 'number' || factor < 0.5 || factor > 2) return;
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.setZoomFactor(factor);
    }
  });
}

export function setupPdfReadingPreferencesIpc(
  isTrusted: (event: IpcMainInvokeEvent) => boolean,
  send: (preferences: PdfReadingPreferences) => void,
) {
  ipcMain.handle(IPC_CHANNELS.getPdfReadingPreferences, async (event) => {
    if (!isTrusted(event)) throw new Error('Untrusted PDF reading preferences request.');
    return getPdfReadingPreferences();
  });
  ipcMain.handle(IPC_CHANNELS.setPdfReadingPreferences, async (event, value: unknown) => {
    if (!isTrusted(event)) throw new Error('Untrusted PDF reading preferences request.');
    const preferences = setPdfReadingPreferences(validatePdfReadingPreferences(value));
    send(preferences);
    return preferences;
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 980,
    minHeight: 700,
    title: 'A11y Notebook',
    backgroundColor: '#0f172a',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      // The main-process scheduler delivers sound events even while minimized.
      // Keep this single trusted renderer responsive; alerts still wait for focus.
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
    setShortcutCaptureActive(false);
  });
  mainWindow.webContents.on('did-start-loading', () => setShortcutCaptureActive(false));
  mainWindow.webContents.on('render-process-gone', () => setShortcutCaptureActive(false));

  // Never open new Electron windows. Only this project's GitHub pages may open, and
  // they open in the user's default browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isRepositoryUrl(url)) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) {
      event.preventDefault();
    }
  });

  if (isDevelopment) {
    void mainWindow.loadURL(DEV_SERVER_URL);
  } else {
    void mainWindow.loadFile(rendererIndexPath);
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    if (process.platform === 'win32') app.setAppUserModelId('com.ripplelearning.a11ynotebook');
    // Renderer permissions stay blocked; native reminders are created in the main process.
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    setupPdfReadingPreferencesIpc(isTrustedSender, (preferences) => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed() && isAppUrl(window.webContents.getURL())) {
          window.webContents.send(IPC_CHANNELS.pdfReadingPreferencesChanged, preferences);
        }
      }
    });

    setupUpdater({
      send: (status) => sendToRenderer(IPC_CHANNELS.updaterStatus, status),
      isTrustedSender,
    });
    ipcMain.handle(IPC_CHANNELS.reminderAlertsReady, (event) => {
      if (!isTrustedSender(event)) throw new Error('Untrusted reminder readiness request.');
      const pending = pendingReminderAlerts;
      pendingReminderAlerts = [];
      return pending;
    });
    const wakeLaunch = process.argv.includes('--a11y-reminder-wake');
    const vaultIpc = setupVaultIpc(
      isTrustedSender,
      (event) => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IPC_CHANNELS.vaultChanged, event);
      },
      (event) => {
        if (event.type === 'fired' || event.type === 'locked-due') {
          pendingReminderAlerts.push(event);
          if (pendingReminderAlerts.length > MAX_PENDING_REMINDER_ALERTS)
            pendingReminderAlerts.splice(0, pendingReminderAlerts.length - MAX_PENDING_REMINDER_ALERTS);
        }
        if (event.type === 'changed') {
          pendingReminderAlerts = pendingReminderAlerts.filter(
            (pending) =>
              pending.type === 'fired' &&
              pending.vaultPath === event.vaultPath &&
              event.reminders.some(
                (item) =>
                  item.id === pending.reminder.id &&
                  item.status === 'fired' &&
                  item.scheduledAt === pending.reminder.scheduledAt,
              ),
          );
        }
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(IPC_CHANNELS.vaultReminderEvent, event);
          if (event.type === 'open') {
            mainWindow.show();
            mainWindow.focus();
          }
        }
      },
      () => {
        pendingReminderAlerts = [];
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(IPC_CHANNELS.vaultSecurityLocked, true);
        }
      },
    );

    setupShortcutCaptureIpc(isTrustedSender, setShortcutCaptureActive);
    setupZoomFactorIpc(isTrustedSender);
    if (wakeLaunch) {
      // Task Scheduler wake: show generic due alerts from the
      // persisted snapshot, re-register the next trigger, and exit
      // without ever opening a window or the library.
      void vaultIpc
        .runReminderWake()
        .catch(() => undefined)
        .then(() => setTimeout(() => app.quit(), 1500));
      return;
    }
    rebuildApplicationMenu();
    ipcMain.on(IPC_CHANNELS.menuState, (event, value: unknown) => {
      if (!isTrustedSender(event) || !isNativeMenuState(value)) return;
      nativeMenuState = value;
      if (applicationMenu && !shortcutCaptureActive) {
        applyNativeMenuState(applicationMenu, nativeMenuState);
      }
    });

    if (!wakeLaunch) createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });
}

app.on('web-contents-created', (_event, contents) => {
  // Block <webview> entirely; A11y Notebook does not use it.
  contents.on('will-attach-webview', (event) => event.preventDefault());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
