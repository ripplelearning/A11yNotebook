import { createHash, randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { Socket } from 'node:net';
import path from 'node:path';
import {
  buildOutlookAuthUrl,
  exchangeOutlookCode,
  isOutlookTokenExpired,
  parseOutlookRedirect,
  refreshOutlookToken,
  type OutlookApiFetch,
  type OutlookAuthClient,
  type OutlookRedirectResult,
} from '../../src/shared/outlook-auth';

/**
 * Main-process Outlook sign-in: encrypted credential storage, the PKCE
 * loopback redirect server, token refresh, and sign-out. It never imports
 * Electron itself: the browser opener, fetch, and encryptor are injected,
 * so the whole flow is testable outside the app shell. The thin IPC
 * wrapper that supplies the real Electron pieces lives in ./ipc.ts.
 *
 * What is stored, and where: a single outlook-auth.json file under the
 * app's user-data directory holds the OAuth client id in plaintext (it is
 * not secret) and the refresh token encrypted. Outlook uses a public
 * native client, so there is no client secret at all; PKCE proves the
 * sign-in instead. Only the refresh token is persisted; access tokens
 * live in memory only and are re-minted by refresh. If secure storage is
 * unavailable, setup refuses rather than writing the token in plaintext.
 *
 * Microsoft offers no token revocation endpoint for this flow, so
 * sign-out clears the local token (and the cached access token) and
 * nothing else; the refresh token then simply stops being used.
 */

export interface OutlookAuthEncryptor {
  isAvailable(): boolean;
  encrypt(plaintext: string): Buffer;
  decrypt(ciphertext: Buffer): string;
}

const FILE_NAME = 'outlook-auth.json';
const SIGN_IN_TIMEOUT_MS = 10 * 60 * 1000;

interface OutlookAuthFile {
  clientId?: string;
  encryptedRefreshToken?: string;
}

function filePath(userDataPath: string): string {
  return path.join(userDataPath, FILE_NAME);
}

function decryptOrThrow(encryptor: OutlookAuthEncryptor, encoded: string, what: string): string {
  let decrypted = '';
  try {
    decrypted = encryptor.decrypt(Buffer.from(encoded, 'base64'));
  } catch {
    decrypted = '';
  }
  if (!decrypted) throw new Error(`Could not decrypt the stored Outlook ${what}.`);
  return decrypted;
}

export interface LoadedOutlookAuth {
  client?: OutlookAuthClient;
  refreshToken?: string;
}

/** Missing file means never set up; malformed or undecryptable means throw. */
export async function loadOutlookAuth(
  userDataPath: string,
  encryptor: OutlookAuthEncryptor,
): Promise<LoadedOutlookAuth> {
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
    throw new Error('The stored Outlook sign-in data is unreadable.');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('The stored Outlook sign-in data is unreadable.');
  }
  const file = parsed as OutlookAuthFile;
  const loaded: LoadedOutlookAuth = {};
  if (typeof file.clientId === 'string' && file.clientId) {
    loaded.client = { clientId: file.clientId };
  }
  if (typeof file.encryptedRefreshToken === 'string' && file.encryptedRefreshToken) {
    loaded.refreshToken = decryptOrThrow(encryptor, file.encryptedRefreshToken, 'refresh token');
  }
  return loaded;
}

async function writeOutlookAuthFile(
  userDataPath: string,
  encryptor: OutlookAuthEncryptor,
  current: OutlookAuthFile,
  patch: Partial<OutlookAuthFile>,
): Promise<void> {
  const next = { ...current, ...patch };
  await writeFile(filePath(userDataPath), JSON.stringify(next), 'utf8');
}

async function readRawFile(userDataPath: string): Promise<OutlookAuthFile> {
  try {
    const raw = await readFile(filePath(userDataPath), 'utf8');
    const parsed = JSON.parse(raw) as OutlookAuthFile;
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function requireEncryption(encryptor: OutlookAuthEncryptor): void {
  if (!encryptor.isAvailable()) {
    throw new Error(
      'Secure storage is not available on this device, so the Outlook refresh token cannot be stored safely.',
    );
  }
}

export async function saveOutlookClient(
  userDataPath: string,
  encryptor: OutlookAuthEncryptor,
  client: OutlookAuthClient,
): Promise<void> {
  if (!client.clientId.trim()) {
    throw new Error('An Outlook client id is required.');
  }
  requireEncryption(encryptor);
  const current = await readRawFile(userDataPath);
  await writeOutlookAuthFile(userDataPath, encryptor, current, {
    clientId: client.clientId,
  });
}

export async function saveOutlookRefreshToken(
  userDataPath: string,
  encryptor: OutlookAuthEncryptor,
  refreshToken: string,
): Promise<void> {
  requireEncryption(encryptor);
  const current = await readRawFile(userDataPath);
  await writeOutlookAuthFile(userDataPath, encryptor, current, {
    encryptedRefreshToken: encryptor.encrypt(refreshToken).toString('base64'),
  });
}

export async function clearOutlookRefreshToken(userDataPath: string): Promise<void> {
  const current = await readRawFile(userDataPath);
  const next = { ...current };
  delete next.encryptedRefreshToken;
  await writeFile(filePath(userDataPath), JSON.stringify(next), 'utf8');
}

/** PKCE pair: a random verifier and its S256 challenge, both base64url. */
export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export interface LoopbackListener {
  redirectUri: string;
  wait(): Promise<OutlookRedirectResult>;
  close(): void;
}

/**
 * Listen on a loopback port for Microsoft's redirect. Loopback redirects
 * are permitted for native-app clients, so no port is pre-registered.
 * Favicon and other non-redirect requests are ignored, not treated as
 * sign-in results. This mirrors the Google loopback server deliberately:
 * the two providers' flows stay independent, so a change to one cannot
 * break the other's sign-in.
 */
export async function listenForOutlookRedirect(
  timeoutMs: number = SIGN_IN_TIMEOUT_MS,
): Promise<LoopbackListener> {
  const sockets = new Set<Socket>();
  let settled = false;
  let closed = false;
  let resolveWait!: (result: OutlookRedirectResult) => void;
  let rejectWait!: (error: Error) => void;
  const wait = new Promise<OutlookRedirectResult>((resolve, reject) => {
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
    const result = parseOutlookRedirect(`http://127.0.0.1${request.url ?? '/'}`);
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
    rejectWait(new Error('Outlook sign-in timed out. Try signing in again.'));
  }, timeoutMs);
  timer.unref();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    close();
    throw new Error('Could not start the Outlook sign-in redirect server.');
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

export interface OutlookSignInDeps {
  userDataPath: string;
  encryptor: OutlookAuthEncryptor;
  openExternal(url: string): Promise<void>;
  fetchImpl: OutlookApiFetch;
  timeoutMs?: number;
}

export async function signInWithOutlook(deps: OutlookSignInDeps): Promise<{ signedIn: true }> {
  if (signInInFlight) throw new Error('An Outlook sign-in is already in progress.');
  signInInFlight = true;
  try {
    const loaded = await loadOutlookAuth(deps.userDataPath, deps.encryptor);
    if (!loaded.client) {
      throw new Error('Outlook sync is not set up yet: no OAuth client is configured.');
    }
    const pkce = createPkcePair();
    const listener = await listenForOutlookRedirect(deps.timeoutMs);
    try {
      await deps.openExternal(
        buildOutlookAuthUrl(loaded.client.clientId, listener.redirectUri, pkce.challenge),
      );
      const result = await listener.wait();
      if (!result.ok) {
        throw new Error(
          result.error === 'access_denied'
            ? 'Outlook sign-in was cancelled.'
            : `Outlook sign-in failed (${result.error}).`,
        );
      }
      const tokens = await exchangeOutlookCode({
        client: loaded.client,
        code: result.code,
        redirectUri: listener.redirectUri,
        codeVerifier: pkce.verifier,
        fetchImpl: deps.fetchImpl,
      });
      if (!tokens.refreshToken) {
        throw new Error('Outlook did not return a refresh token, so sign-in cannot stay signed in.');
      }
      await saveOutlookRefreshToken(deps.userDataPath, deps.encryptor, tokens.refreshToken);
      cachedAccessToken = { accessToken: tokens.accessToken, expiresAt: tokens.expiresAt };
      return { signedIn: true as const };
    } finally {
      listener.close();
    }
  } finally {
    signInInFlight = false;
  }
}

export interface OutlookAccessTokenDeps {
  userDataPath: string;
  encryptor: OutlookAuthEncryptor;
  fetchImpl: OutlookApiFetch;
}

/** A current access token, refreshing from the stored refresh token when needed. */
export async function getOutlookAccessToken(deps: OutlookAccessTokenDeps): Promise<string> {
  if (cachedAccessToken && !isOutlookTokenExpired(cachedAccessToken)) {
    return cachedAccessToken.accessToken;
  }
  const loaded = await loadOutlookAuth(deps.userDataPath, deps.encryptor);
  if (!loaded.client || !loaded.refreshToken) {
    throw new Error('Not signed in with Outlook.');
  }
  const refreshed = await refreshOutlookToken({
    client: loaded.client,
    refreshToken: loaded.refreshToken,
    fetchImpl: deps.fetchImpl,
  });
  if (refreshed.refreshToken) {
    await saveOutlookRefreshToken(deps.userDataPath, deps.encryptor, refreshed.refreshToken);
  }
  cachedAccessToken = { accessToken: refreshed.accessToken, expiresAt: refreshed.expiresAt };
  return refreshed.accessToken;
}

export async function signOutWithOutlook(deps: {
  userDataPath: string;
  encryptor: OutlookAuthEncryptor;
}): Promise<void> {
  cachedAccessToken = undefined;
  await clearOutlookRefreshToken(deps.userDataPath);
}

export async function getOutlookAuthStatus(deps: {
  userDataPath: string;
  encryptor: OutlookAuthEncryptor;
}): Promise<{ configured: boolean; signedIn: boolean }> {
  const loaded = await loadOutlookAuth(deps.userDataPath, deps.encryptor);
  return { configured: loaded.client !== undefined, signedIn: loaded.refreshToken !== undefined };
}
