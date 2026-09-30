// Update state machine for the main process. It is deliberately independent of
// Electron and electron-updater so it can be unit tested; electron/updater.ts wires
// it to the real autoUpdater and IPC.
import {
  formatUpdaterError,
  normalizePercent,
  summarizeReleaseNotes,
  UPDATES_DEV_BUILD_MESSAGE,
  UPDATES_PORTABLE_MESSAGE,
  type UpdaterStatus,
} from '../src/shared/updater';

/** The subset of electron-updater's UpdateCheckResult the controller relies on. */
export type UpdateCheckResultLike = {
  isUpdateAvailable?: boolean;
  updateInfo?: UpdateInfoLike;
} | null;

export type UpdaterEngine = {
  checkForUpdates: () => Promise<UpdateCheckResultLike | undefined | void>;
  downloadUpdate: () => Promise<unknown>;
  quitAndInstall: (isSilent: boolean, isForceRunAfter: boolean) => void;
  setAutoInstallOnAppQuit: (value: boolean) => void;
};

export type UpdaterControllerOptions = {
  isPackaged: boolean;
  isPortable: boolean;
  currentVersion: string;
  engine: UpdaterEngine;
  send: (status: UpdaterStatus) => void;
};

export type UpdateInfoLike = {
  version: string;
  releaseName?: string | null;
  releaseNotes?: string | Array<{ version?: string; note?: string | null }> | null;
};

type Phase = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded';

export type UpdaterController = ReturnType<typeof createUpdaterController>;

export function createUpdaterController({
  isPackaged,
  isPortable,
  currentVersion,
  engine,
  send,
}: UpdaterControllerOptions) {
  let phase: Phase = 'idle';
  let lastStatus: UpdaterStatus = { state: 'idle' };
  let downloadedVersion = '';

  const emit = (status: UpdaterStatus) => {
    // electron-updater reports some failures both through the "error" event and a
    // rejected promise; only announce the same error once.
    if (status.state === 'error' && lastStatus.state === 'error' && lastStatus.message === status.message) {
      return;
    }
    lastStatus = status;
    send(status);
  };

  const emitError = (message: string) => emit({ state: 'error', message });

  const unsupportedReason = (): string | null => {
    if (!isPackaged) {
      return UPDATES_DEV_BUILD_MESSAGE;
    }
    if (isPortable) {
      return UPDATES_PORTABLE_MESSAGE;
    }
    return null;
  };

  const controller = {
    getPhase: () => phase,

    async check() {
      const reason = unsupportedReason();
      if (reason) {
        emit({ state: 'unsupported', message: reason });
        return;
      }
      if (phase === 'checking' || phase === 'downloading') {
        send(lastStatus);
        return;
      }
      if (phase === 'downloaded') {
        emit({ state: 'update-downloaded', version: downloadedVersion });
        return;
      }
      phase = 'checking';
      emit({ state: 'checking' });
      try {
        const result = await engine.checkForUpdates();
        // electron-updater normally emits its events before resolving; fall back to the
        // resolved result so the outcome never depends on event ordering.
        if (phase === 'checking') {
          if (result?.updateInfo && result.isUpdateAvailable === true) {
            controller.handleUpdateAvailable(result.updateInfo);
          } else if (result?.updateInfo && result.isUpdateAvailable === false) {
            controller.handleUpdateNotAvailable();
          } else {
            phase = 'idle';
            emitError('The update check did not complete. Please try again.');
          }
        }
      } catch (error) {
        phase = 'idle';
        emitError(formatUpdaterError(error));
      }
    },

    async download() {
      if (phase === 'downloading' || phase === 'downloaded') {
        send(lastStatus);
        return;
      }
      if (phase !== 'available') {
        emitError('There is no update ready to download. Check for updates first.');
        return;
      }
      phase = 'downloading';
      emit({ state: 'download-progress', percent: 0 });
      try {
        await engine.downloadUpdate();
      } catch (error) {
        if (phase === 'downloading') {
          phase = 'available';
        }
        emitError(formatUpdaterError(error));
      }
    },

    installNow() {
      if (phase !== 'downloaded') {
        emitError('No downloaded update is ready to install.');
        return;
      }
      engine.quitAndInstall(false, true);
    },

    installOnExit() {
      if (phase !== 'downloaded') {
        emitError('No downloaded update is ready to install.');
        return;
      }
      engine.setAutoInstallOnAppQuit(true);
    },

    handleUpdateAvailable(info: UpdateInfoLike) {
      phase = 'available';
      emit({
        state: 'update-available',
        version: info.version,
        releaseName: info.releaseName ?? undefined,
        releaseNotes: summarizeReleaseNotes(info.releaseNotes),
      });
    },

    handleUpdateNotAvailable() {
      phase = 'idle';
      emit({ state: 'update-not-available', version: currentVersion });
    },

    handleDownloadProgress(progress: { percent: number }) {
      if (phase !== 'downloading') {
        return;
      }
      emit({ state: 'download-progress', percent: normalizePercent(progress.percent) });
    },

    handleUpdateDownloaded(info: UpdateInfoLike) {
      phase = 'downloaded';
      downloadedVersion = info.version;
      emit({ state: 'update-downloaded', version: info.version });
    },

    handleError(error: unknown) {
      if (phase === 'checking') {
        phase = 'idle';
      } else if (phase === 'downloading') {
        phase = 'available';
      }
      emitError(formatUpdaterError(error));
    },
  };
  return controller;
}
