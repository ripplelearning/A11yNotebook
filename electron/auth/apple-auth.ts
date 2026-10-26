import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  discoverAppleCalendar,
  type AppleTransportFetch,
} from '../../src/shared/apple-transport';

/**
 * Main-process Apple sign-in storage: the Apple ID and app-specific
 * password live in a single apple-auth.json file under the app's
 * user-data directory. The Apple ID is an identifier and is stored in
 * plaintext; the app-specific password is encrypted with the
 * safeStorage-backed encryptor. If secure storage is unavailable, setup
 * refuses rather than writing the password in plaintext.
 *
 * This is deliberately NOT the main Apple ID password: Apple issues
 * app-specific passwords per app, shown once, revocable any time at
 * appleid.apple.com, and they grant only CalDAV calendar access for
 * that app. The password is held in renderer memory only for the
 * duration of a sync run (through the credentials bridge method) and
 * is never written to disk by the renderer; revoking it at Apple
 * instantly cuts access.
 */

export interface AppleAuthEncryptor {
  isAvailable(): boolean;
  encrypt(plaintext: string): Buffer;
  decrypt(ciphertext: Buffer): string;
}

const FILE_NAME = 'apple-auth.json';

interface AppleAuthFile {
  appleId?: string;
  encryptedAppPassword?: string;
}

function filePath(userDataPath: string): string {
  return path.join(userDataPath, FILE_NAME);
}

function decryptOrThrow(encryptor: AppleAuthEncryptor, encoded: string, what: string): string {
  let decrypted = '';
  try {
    decrypted = encryptor.decrypt(Buffer.from(encoded, 'base64'));
  } catch {
    decrypted = '';
  }
  if (!decrypted) throw new Error(`Could not decrypt the stored Apple ${what}.`);
  return decrypted;
}

export interface LoadedAppleAuth {
  appleId?: string;
  appPassword?: string;
}

/** Missing file means never set up; malformed or undecryptable means throw. */
export async function loadAppleAuth(
  userDataPath: string,
  encryptor: AppleAuthEncryptor,
): Promise<LoadedAppleAuth> {
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
    throw new Error('The stored Apple sign-in data is unreadable.');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('The stored Apple sign-in data is unreadable.');
  }
  const file = parsed as AppleAuthFile;
  const loaded: LoadedAppleAuth = {};
  if (typeof file.appleId === 'string' && file.appleId) {
    loaded.appleId = file.appleId;
  }
  if (typeof file.encryptedAppPassword === 'string' && file.encryptedAppPassword) {
    loaded.appPassword = decryptOrThrow(encryptor, file.encryptedAppPassword, 'app-specific password');
  }
  return loaded;
}

async function readRawFile(userDataPath: string): Promise<AppleAuthFile> {
  try {
    const raw = await readFile(filePath(userDataPath), 'utf8');
    const parsed = JSON.parse(raw) as AppleAuthFile;
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function requireEncryption(encryptor: AppleAuthEncryptor): void {
  if (!encryptor.isAvailable()) {
    throw new Error(
      'Secure storage is not available on this device, so the Apple app-specific password cannot be stored safely.',
    );
  }
}

export async function saveAppleSignIn(
  userDataPath: string,
  encryptor: AppleAuthEncryptor,
  signIn: { appleId: string; appPassword: string },
): Promise<void> {
  if (!signIn.appleId.trim()) {
    throw new Error('An Apple ID is required.');
  }
  if (!signIn.appPassword.trim()) {
    throw new Error('An app-specific password is required.');
  }
  requireEncryption(encryptor);
  const current = await readRawFile(userDataPath);
  await writeFile(
    filePath(userDataPath),
    JSON.stringify({
      ...current,
      appleId: signIn.appleId,
      encryptedAppPassword: encryptor.encrypt(signIn.appPassword).toString('base64'),
    }),
    'utf8',
  );
}

export async function clearAppleAppPassword(userDataPath: string): Promise<void> {
  const current = await readRawFile(userDataPath);
  const next = { ...current };
  delete next.encryptedAppPassword;
  await writeFile(filePath(userDataPath), JSON.stringify(next), 'utf8');
}

export async function getAppleAuthStatus(deps: {
  userDataPath: string;
  encryptor: AppleAuthEncryptor;
}): Promise<{ configured: boolean; signedIn: boolean }> {
  const loaded = await loadAppleAuth(deps.userDataPath, deps.encryptor);
  return { configured: loaded.appleId !== undefined, signedIn: loaded.appPassword !== undefined };
}

export async function getAppleCredentials(deps: {
  userDataPath: string;
  encryptor: AppleAuthEncryptor;
}): Promise<{ appleId: string; appPassword: string }> {
  const loaded = await loadAppleAuth(deps.userDataPath, deps.encryptor);
  if (!loaded.appleId || !loaded.appPassword) {
    throw new Error('Not signed in with Apple.');
  }
  return { appleId: loaded.appleId, appPassword: loaded.appPassword };
}

/**
 * Verify a saved Apple sign-in by running CalDAV discovery in main and
 * returning the calendar it finds. The renderer calls this after saving
 * so a typo'd password fails fast with Apple's own error, before any
 * sync run. The discovered URL stays in main; the renderer re-discovers
 * during its sync run.
 */
export async function verifyAppleCalendar(deps: {
  userDataPath: string;
  encryptor: AppleAuthEncryptor;
  fetchImpl: AppleTransportFetch;
}): Promise<{ calendarName: string }> {
  const credentials = await getAppleCredentials(deps);
  const discovered = await discoverAppleCalendar({
    appleId: credentials.appleId,
    appPassword: credentials.appPassword,
    fetchImpl: deps.fetchImpl,
  });
  return { calendarName: discovered.displayName };
}
