import { readFile, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { Socket } from 'node:net';
import path from 'node:path';
import {
  buildGoogleAuthUrl,
  exchangeGoogleCode,
  isGoogleTokenExpired,
  parseGoogleRedirect,
  refreshGoogleToken,
  type GoogleApiFetch,
  type GoogleAuthClient,
  type GoogleRedirectResult,
} from '../../src/shared/google-auth';

/**
 * Main-process Google sign-in: encrypted credential storage, the loopback
 * redirect server, token refresh, and sign-out. It never imports Electron
 * itself: the browser opener, fetch, and encryptor are injected, so the
 * whole flow is testable outside the app shell. The thin IPC wrapper that
 * supplies the real Electron pieces lives in ./ipc.ts.
 *
 * What is stored, and where: a single google-auth.json file under the
 * app's user-data directory holds the OAuth client id in plaintext (it is
 * not secret) and the client secret plus refresh token encrypted. Only the
 * refresh token is persisted; access tokens live in memory only and are
 * re-minted by refresh. If secure storage is unavailable, setup refuses
 * rather than writing secrets in plaintext.
 */

export interface GoogleAuthEncryptor {
  isAvailable(): boolean;
  encrypt(plaintext: string): Buffer;
  decrypt(ciphertext: Buffer): string;
}

const FILE_NAME = 'google-auth.json';
const SIGN_IN_TIMEOUT_MS = 10 * 60 * 1000;

interface GoogleAuthFile {
  clientId?: string;
  encryptedSecret?: string;
  encryptedRefreshToken?: string;
}

function filePath(userDataPath: string): string {
  return path.join(userDataPath, FILE_NAME);
}

function decryptOrThrow(encryptor: GoogleAuthEncryptor, encoded: string, what: string): string {
  let decrypted = '';
  try {
    decrypted = encryptor.decrypt(Buffer.from(encoded, 'base64'));
  } catch {
    decrypted = '';
  }
  if (!decrypted) throw new Error(`Could not decrypt the stored Google ${what}.`);
  return decrypted;
}

export interface LoadedGoogleAuth {
  client?: GoogleAuthClient;
  refreshToken?: string;
}

/** Missing file means never set up; malformed or undecryptable means throw. */
export async function loadGoogleAuth(
  userDataPath: string,
  encryptor: GoogleAuthEncryptor,
): Promise<LoadedGoogleAuth> {
  let raw: string;
  try {
    raw = await readFile(filePath(userDataPath), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('The stored Google sign-in data is unreadable.');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('The stored Google sign-in data is unreadable.');
  }
  const file = parsed as GoogleAuthFile;
  const loaded: LoadedGoogleAuth = {};
  if (typeof file.clientId === 'string' && file.clientId) {
    if (typeof file.encryptedSecret !== 'string' || !file.encryptedSecret) {
      throw new Error('The stored Google client secret is missing.');
    }
    loaded.client = {
      clientId: file.clientId,
      clientSecret: decryptOrThrow(encryptor, file.encryptedSecret, 'client secret'),
    };
  }
  if (typeof file.encryptedRefreshToken === 'string' && file.encryptedRefreshToken) {
    loaded.refreshToken = decryptOrThrow(encryptor, file.encryptedRefreshToken, 'refresh token');
  }
  return loaded;
}

async function writeGoogleAuthFile(
  userDataPath: string,
  encryptor: GoogleAuthEncryptor,
  current: GoogleAuthFile,
  patch: Partial<GoogleAuthFile>,
): Promise<void> {
  const next = { ...current, ...patch };
  await writeFile(filePath(userDataPath), JSON.stringify(next), 'utf8');
}

async function readRawFile(userDataPath: string): Promise<GoogleAuthFile> {
  try {
    const raw = await readFile(filePath(userDataPath), 'utf8');
    const parsed = JSON.parse(raw) as GoogleAuthFile;
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function requireEncryption(encryptor: GoogleAuthEncryptor): void {
  if (!encryptor.isAvailable()) {
    throw new Error(
      'Secure storage is not available on this device, so the Google client secret cannot be stored safely.',
    );
  }
}

export async function saveGoogleClient(
  userDataPath: string,
  encryptor: GoogleAuthEncryptor,
  client: GoogleAuthClient,
): Promise<void> {
  if (!client.clientId.trim() || !client.clientSecret.trim()) {
    throw new Error('A Google client id and client secret are both required.');
  }
  requireEncryption(encryptor);
  const current = await readRawFile(userDataPath);
  await writeGoogleAuthFile(userDataPath, encryptor, current, {
    clientId: client.clientId,
    encryptedSecret: encryptor.encrypt(client.clientSecret).toString('base64'),
  });
}

export async function saveGoogleRefreshToken(
  userDataPath: string,
  encryptor: GoogleAuthEncryptor,
  refreshToken: string,
): Promise<void> {
  requireEncryption(encryptor);
  const current = await readRawFile(userDataPath);
  await writeGoogleAuthFile(userDataPath, encryptor, current, {
    encryptedRefreshToken: encryptor.encrypt(refreshToken).toString('base64'),
  });
}

export async function clearGoogleRefreshToken(userDataPath: string): Promise<void> {
  const current = await readRawFile(userDataPath);
  const next = { ...current };
  delete next.encryptedRefreshToken;
  await writeFile(filePath(userDataPath), JSON.stringify(next), 'utf8');
}

export interface LoopbackListener {
  redirectUri: string;
  wait(): Promise<GoogleRedirectResult>;
  close(): void;
}

/**
 * Listen on a loopback port for Google's redirect. Google permits any
 * loopback port for Desktop-app clients, so no port is pre-registered.
 * Favicon and other non-redirect requests are ignored, not treated as
 * sign-in results.
 */
export async function listenForGoogleRedirect(timeoutMs: number = SIGN_IN_TIMEOUT_MS): Promise<LoopbackListener> {
  const sockets = new Set<Socket>();
  let settled = false;
  let closed = false;
  let resolveWait!: (result: GoogleRedirectResult) => void;
  let rejectWait!: (error: Error) => void;
  const wait = new Promise<GoogleRedirectResult>((resolve, reject) => {
    resolveWait = resolve;
    rejectWait = reject;
  });
  const server: Server = createServer((request, response) => {
    const headers = { 'Content-Type': 'text/html; charset=utf-8', Connection: 'close' };
    if (settled) {
      response.writeHead(200, headers);
      response.end('<!doctype html><title>Sign-in complete</title><h1>Sign-in complete</h1>');
      return;
    }
    const result = parseGoogleRedirect(`http://127.0.0.1${request.url ?? '/'}`);
    if (!result.ok && result.error === 'missing_code') {
      // Not a sign-in result (for example a favicon fetch): answer so the
      // requester does not hang, but do not settle the sign-in wait.
      response.writeHead(404, headers);
      response.end('<!doctype html><title>Not found</title><h1>Not a sign-in redirect</h1>');
      return;
    }
    settled = true;
    if (timer) clearTimeout(timer);
    response.writeHead(200, headers);
    // Resolve only after the page has flushed, so closing the server below
    // cannot truncate it.
    response.end(
      '<!doctype html><title>Sign-in complete</title><h1>Sign-in complete</h1><p>You can close this tab and return to A11y Notebook.</p>',
      () => resolveWait(result),
    );
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  const close = (): void => {
    if (closed) return;
    closed = true;
    if (timer) clearTimeout(timer);
    for (const socket of sockets) socket.destroy();
    server.close();
  };
  const timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    close();
    rejectWait(new Error('Google sign-in timed out. Try signing in again.'));
  }, timeoutMs);
  timer.unref();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    close();
    throw new Error('Could not start the Google sign-in redirect server.');
  }
  return {
    redirectUri: `http://127.0.0.1:${address.port}`,
    wait: () =>
      wait.finally(() => {
        close();
      }),
    close,
  };
}

let cachedAccessToken: { accessToken: string; expiresAt: number } | undefined;
let signInInFlight = false;

export interface GoogleSignInDeps {
  userDataPath: string;
  encryptor: GoogleAuthEncryptor;
  openExternal(url: string): Promise<void>;
  fetchImpl: GoogleApiFetch;
  timeoutMs?: number;
}

export async function signInWithGoogle(deps: GoogleSignInDeps): Promise<{ signedIn: true }> {
  if (signInInFlight) throw new Error('A Google sign-in is already in progress.');
  signInInFlight = true;
  try {
    const loaded = await loadGoogleAuth(deps.userDataPath, deps.encryptor);
    if (!loaded.client) {
      throw new Error('Google sync is not set up yet: no OAuth client is configured.');
    }
    const listener = await listenForGoogleRedirect(deps.timeoutMs);
    try {
      await deps.openExternal(buildGoogleAuthUrl(loaded.client.clientId, listener.redirectUri));
      const result = await listener.wait();
      if (!result.ok) {
        throw new Error(
          result.error === 'access_denied'
            ? 'Google sign-in was cancelled.'
            : `Google sign-in failed (${result.error}).`,
        );
      }
      const tokens = await exchangeGoogleCode({
        client: loaded.client,
        code: result.code,
        redirectUri: listener.redirectUri,
        fetchImpl: deps.fetchImpl,
      });
      if (!tokens.refreshToken) {
        throw new Error('Google did not return a refresh token, so sign-in cannot stay signed in.');
      }
      await saveGoogleRefreshToken(deps.userDataPath, deps.encryptor, tokens.refreshToken);
      cachedAccessToken = { accessToken: tokens.accessToken, expiresAt: tokens.expiresAt };
      return { signedIn: true as const };
    } finally {
      listener.close();
    }
  } finally {
    signInInFlight = false;
  }
}

export interface GoogleAccessTokenDeps {
  userDataPath: string;
  encryptor: GoogleAuthEncryptor;
  fetchImpl: GoogleApiFetch;
}

/** A current access token, refreshing from the stored refresh token when needed. */
export async function getGoogleAccessToken(deps: GoogleAccessTokenDeps): Promise<string> {
  if (cachedAccessToken && !isGoogleTokenExpired(cachedAccessToken)) {
    return cachedAccessToken.accessToken;
  }
  const loaded = await loadGoogleAuth(deps.userDataPath, deps.encryptor);
  if (!loaded.client || !loaded.refreshToken) {
    throw new Error('Not signed in with Google.');
  }
  const refreshed = await refreshGoogleToken({
    client: loaded.client,
    refreshToken: loaded.refreshToken,
    fetchImpl: deps.fetchImpl,
  });
  if (refreshed.refreshToken) {
    await saveGoogleRefreshToken(deps.userDataPath, deps.encryptor, refreshed.refreshToken);
  }
  cachedAccessToken = { accessToken: refreshed.accessToken, expiresAt: refreshed.expiresAt };
  return refreshed.accessToken;
}

export async function signOutWithGoogle(deps: {
  userDataPath: string;
  encryptor: GoogleAuthEncryptor;
  fetchImpl?: GoogleApiFetch;
}): Promise<void> {
  const loaded = await loadGoogleAuth(deps.userDataPath, deps.encryptor);
  // Best effort: local sign-out must not fail because revocation did.
  if (loaded.refreshToken && deps.fetchImpl) {
    try {
      await deps.fetchImpl('https://oauth2.googleapis.com/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: loaded.refreshToken }).toString(),
      });
    } catch {
      // Ignored: the token is cleared locally below regardless.
    }
  }
  cachedAccessToken = undefined;
  await clearGoogleRefreshToken(deps.userDataPath);
}

export async function getGoogleAuthStatus(deps: {
  userDataPath: string;
  encryptor: GoogleAuthEncryptor;
}): Promise<{ configured: boolean; signedIn: boolean }> {
  const loaded = await loadGoogleAuth(deps.userDataPath, deps.encryptor);
  return { configured: loaded.client !== undefined, signedIn: loaded.refreshToken !== undefined };
}
