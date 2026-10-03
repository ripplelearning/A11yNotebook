// Wires the update controller to electron-updater and the whitelisted IPC channels.
import { app, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { autoUpdater } from 'electron-updater';
import { REPOSITORY_NAME, REPOSITORY_OWNER } from '../src/shared/app-info';
import { IPC_CHANNELS, UPDATER_INVOKE_CHANNELS, isInvokeChannel, type UpdaterInvokeChannel } from '../src/shared/ipc';
import type { UpdaterStatus } from '../src/shared/updater';
import { createUpdaterController } from './updater-controller';

type UpdaterWiringOptions = {
  /** Deliver a status message to the application window. */
  send: (status: UpdaterStatus) => void;
  /** Return true only for IPC calls coming from the application's own top-level renderer. */
  isTrustedSender: (event: IpcMainInvokeEvent) => boolean;
};

export function setupUpdater({ send, isTrustedSender }: UpdaterWiringOptions) {
  // Updates are strictly user-initiated: never download or install without consent.
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowDowngrade = false;
  autoUpdater.allowPrerelease = false;

  // Pin the feed to this repository's GitHub Releases. The renderer can never change it,
  // and no token is embedded: public releases are readable anonymously.
  if (app.isPackaged) {
    autoUpdater.setFeedURL({ provider: 'github', owner: REPOSITORY_OWNER, repo: REPOSITORY_NAME });
  }

  const controller = createUpdaterController({
    isPackaged: app.isPackaged,
    isPortable: Boolean(process.env.PORTABLE_EXECUTABLE_FILE),
    currentVersion: app.getVersion(),
    send,
    engine: {
      checkForUpdates: () => autoUpdater.checkForUpdates(),
      downloadUpdate: () => autoUpdater.downloadUpdate(),
      quitAndInstall: (isSilent, isForceRunAfter) => autoUpdater.quitAndInstall(isSilent, isForceRunAfter),
      setAutoInstallOnAppQuit: (value) => {
        autoUpdater.autoInstallOnAppQuit = value;
      },
    },
  });

  autoUpdater.on('update-available', (info) => controller.handleUpdateAvailable(info));
  autoUpdater.on('update-not-available', () => controller.handleUpdateNotAvailable());
  autoUpdater.on('download-progress', (progress) => controller.handleDownloadProgress(progress));
  autoUpdater.on('update-downloaded', (info) => controller.handleUpdateDownloaded(info));
  autoUpdater.on('error', (error) => controller.handleError(error));

  const handlers: Record<UpdaterInvokeChannel, () => unknown> = {
    [IPC_CHANNELS.updaterCheck]: () => controller.check(),
    [IPC_CHANNELS.updaterDownload]: () => controller.download(),
    [IPC_CHANNELS.updaterInstallNow]: () => controller.installNow(),
    [IPC_CHANNELS.updaterInstallOnExit]: () => controller.installOnExit(),
  };

  for (const channel of UPDATER_INVOKE_CHANNELS) {
    // Handlers ignore any arguments sent by the renderer.
    ipcMain.handle(channel, async (event) => {
      if (!isInvokeChannel(channel) || !isTrustedSender(event)) {
        throw new Error('Rejected IPC request from an untrusted sender.');
      }
      await handlers[channel]();
    });
  }

  return controller;
}
