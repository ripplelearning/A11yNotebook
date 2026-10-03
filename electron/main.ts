import { app, BrowserWindow, Menu, protocol, session, shell, type IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPOSITORY_URL } from '../src/shared/app-info';
import { IPC_CHANNELS, isMenuCommand, type MenuCommand } from '../src/shared/ipc';
import type { UpdaterStatus } from '../src/shared/updater';
import { buildApplicationMenu } from './menu';
import { setupUpdater } from './updater';
import { setupVaultIpc } from './vault/ipc';

const isDevelopment = !app.isPackaged;
const DEV_SERVER_URL = 'http://127.0.0.1:5173';
protocol.registerSchemesAsPrivileged([{ scheme: 'vault-file', privileges: { standard: true, secure: true } }]);

// Compiled output lives in dist-electron/electron/, the renderer build in dist/.
const rendererIndexPath = path.join(__dirname, '..', '..', 'dist', 'index.html');
const rendererIndexUrl = pathToFileURL(rendererIndexPath).href;

let mainWindow: BrowserWindow | null = null;

function isAppUrl(url: string) {
  if (isDevelopment && url.startsWith(`${DEV_SERVER_URL}/`)) {
    return true;
  }
  return url.split(/[?#]/)[0] === rendererIndexUrl;
}

function isTrustedSender(event: IpcMainInvokeEvent) {
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
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
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
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

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
    // The renderer does not need camera, microphone, notifications, or other permissions yet.
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));

    setupUpdater({
      send: (status) => sendToRenderer(IPC_CHANNELS.updaterStatus, status),
      isTrustedSender,
    });
    setupVaultIpc(
      isTrustedSender,
      (event) => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IPC_CHANNELS.vaultChanged, event);
      },
      (event) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(IPC_CHANNELS.vaultReminderEvent, event);
          if (event.type === 'open') {
            mainWindow.show();
            mainWindow.focus();
          }
        }
      },
    );

    Menu.setApplicationMenu(
      buildApplicationMenu((command) => {
        if (isMenuCommand(command)) {
          sendToRenderer(IPC_CHANNELS.menuCommand, command);
        }
      }, isDevelopment),
    );

    createWindow();

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
