import { app, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import type { GoogleApiFetch } from '../../src/shared/google-auth';
import { IPC_CHANNELS } from '../../src/shared/ipc';
import {
  getGoogleAccessToken,
  getGoogleAuthStatus,
  saveGoogleClient,
  signInWithGoogle,
  signOutWithGoogle,
} from './google-auth';
import { safeStorageEncryptor } from './safe-storage';

/**
 * Auth IPC handlers. They check only the trusted sender: sign-in is
 * app-level, not library content, so unlike vault handlers they never
 * require an unlocked library. Secrets cross IPC only from the trusted
 * renderer to main (client setup); tokens never go to the renderer except
 * the short-lived access token the sync run itself needs, and it lives in
 * renderer memory only for that run.
 */

type TrustedSender = (event: IpcMainInvokeEvent) => boolean;

function assertTrusted(event: IpcMainInvokeEvent, isTrustedSender: TrustedSender): void {
  if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender.');
}

function userDataPath(): string {
  return app.getPath('userData');
}

function asFetch(): GoogleApiFetch {
  return globalThis.fetch as unknown as GoogleApiFetch;
}

export function setupAuthIpc(isTrustedSender: TrustedSender): void {
  ipcMain.handle(IPC_CHANNELS.authGoogleConfigure, async (event, client: unknown) => {
    assertTrusted(event, isTrustedSender);
    if (
      typeof client !== 'object' ||
      client === null ||
      typeof (client as { clientId?: unknown }).clientId !== 'string' ||
      typeof (client as { clientSecret?: unknown }).clientSecret !== 'string'
    ) {
      throw new Error('A Google client id and client secret are both required.');
    }
    const { clientId, clientSecret } = client as { clientId: string; clientSecret: string };
    await saveGoogleClient(userDataPath(), safeStorageEncryptor, { clientId, clientSecret });
    return { configured: true };
  });

  ipcMain.handle(IPC_CHANNELS.authGoogleSignIn, async (event) => {
    assertTrusted(event, isTrustedSender);
    return signInWithGoogle({
      userDataPath: userDataPath(),
      encryptor: safeStorageEncryptor,
      openExternal: (url) => shell.openExternal(url),
      fetchImpl: asFetch(),
    });
  });

  ipcMain.handle(IPC_CHANNELS.authGoogleStatus, async (event) => {
    assertTrusted(event, isTrustedSender);
    return getGoogleAuthStatus({ userDataPath: userDataPath(), encryptor: safeStorageEncryptor });
  });

  ipcMain.handle(IPC_CHANNELS.authGoogleAccessToken, async (event) => {
    assertTrusted(event, isTrustedSender);
    return getGoogleAccessToken({
      userDataPath: userDataPath(),
      encryptor: safeStorageEncryptor,
      fetchImpl: asFetch(),
    });
  });

  ipcMain.handle(IPC_CHANNELS.authGoogleSignOut, async (event) => {
    assertTrusted(event, isTrustedSender);
    await signOutWithGoogle({
      userDataPath: userDataPath(),
      encryptor: safeStorageEncryptor,
      fetchImpl: asFetch(),
    });
    return { signedIn: false };
  });
}
