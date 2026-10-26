import { get } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getGoogleAuthStatus,
  listenForGoogleRedirect,
  loadGoogleAuth,
  saveGoogleClient,
  saveGoogleRefreshToken,
  signInWithGoogle,
  signOutWithGoogle,
  type GoogleAuthEncryptor,
} from '../../electron/auth/google-auth';
import type { GoogleApiFetch } from '../shared/google-auth';

const strictEncryptor: GoogleAuthEncryptor = {
  isAvailable: () => true,
  encrypt: (plaintext) => Buffer.from(`enc:${plaintext}`),
  decrypt: (ciphertext) => {
    const text = ciphertext.toString();
    if (!text.startsWith('enc:')) throw new Error('Cannot decrypt.');
    return text.slice(4);
  },
};

const unavailableEncryptor: GoogleAuthEncryptor = {
  isAvailable: () => false,
  encrypt: () => Buffer.from(''),
  decrypt: () => '',
};

function httpGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    get(url, (response) => {
      let body = '';
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => resolve(body));
    }).on('error', reject);
  });
}

function tokenFetch(data: Record<string, unknown>): GoogleApiFetch {
  return async () => ({
    ok: true,
    status: 200,
    json: async () => data,
    text: async () => JSON.stringify(data),
  });
}

let temporaryDirectory = '';

beforeEach(async () => {
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'a11y-google-auth-'));
});

afterEach(async () => {
  await rm(temporaryDirectory, { recursive: true, force: true });
});

describe('google auth storage and flow', () => {
  it('round-trips client and refresh token, and clears only the token on sign-out', async () => {
    await saveGoogleClient(temporaryDirectory, strictEncryptor, {
      clientId: 'cid',
      clientSecret: 'csecret',
    });
    await saveGoogleRefreshToken(temporaryDirectory, strictEncryptor, 'rt-1');
    expect(await loadGoogleAuth(temporaryDirectory, strictEncryptor)).toEqual({
      client: { clientId: 'cid', clientSecret: 'csecret' },
      refreshToken: 'rt-1',
    });
    expect(
      await getGoogleAuthStatus({ userDataPath: temporaryDirectory, encryptor: strictEncryptor }),
    ).toEqual({ configured: true, signedIn: true });
    await signOutWithGoogle({ userDataPath: temporaryDirectory, encryptor: strictEncryptor });
    expect(await loadGoogleAuth(temporaryDirectory, strictEncryptor)).toEqual({
      client: { clientId: 'cid', clientSecret: 'csecret' },
    });
  });

  it('refuses to store a client secret without secure storage', async () => {
    await expect(
      saveGoogleClient(temporaryDirectory, unavailableEncryptor, {
        clientId: 'cid',
        clientSecret: 'csecret',
      }),
    ).rejects.toThrow('Secure storage');
  });

  it('reports never-set-up as empty and rejects unreadable files', async () => {
    expect(await loadGoogleAuth(temporaryDirectory, strictEncryptor)).toEqual({});
    await writeFile(path.join(temporaryDirectory, 'google-auth.json'), 'not json');
    await expect(loadGoogleAuth(temporaryDirectory, strictEncryptor)).rejects.toThrow('unreadable');
  });

  it('captures the loopback code and ignores favicon requests', async () => {
    const listener = await listenForGoogleRedirect(5000);
    const pending = listener.wait();
    await httpGet(`${listener.redirectUri}/favicon.ico`);
    await httpGet(`${listener.redirectUri}/?code=abc123`);
    await expect(pending).resolves.toEqual({ ok: true, code: 'abc123' });
    listener.close();
  });

  it('times out a loopback wait that never receives a redirect', async () => {
    const listener = await listenForGoogleRedirect(20);
    await expect(listener.wait()).rejects.toThrow('timed out');
    listener.close();
  });

  it('signs in end to end through the loopback redirect', async () => {
    await saveGoogleClient(temporaryDirectory, strictEncryptor, {
      clientId: 'cid',
      clientSecret: 'csecret',
    });
    const opened: string[] = [];
    const result = await signInWithGoogle({
      userDataPath: temporaryDirectory,
      encryptor: strictEncryptor,
      openExternal: async (url) => {
        opened.push(url);
        const redirectUri = new URL(url).searchParams.get('redirect_uri')!;
        await httpGet(`${redirectUri}/?code=test-code`);
      },
      fetchImpl: tokenFetch({ access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600 }),
      timeoutMs: 5000,
    });
    expect(result).toEqual({ signedIn: true });
    expect(opened[0]).toContain('accounts.google.com');
    expect((await loadGoogleAuth(temporaryDirectory, strictEncryptor)).refreshToken).toBe('rt-1');
  });

  it('turns a Google denial into a cancellation error', async () => {
    await saveGoogleClient(temporaryDirectory, strictEncryptor, {
      clientId: 'cid',
      clientSecret: 'csecret',
    });
    await expect(
      signInWithGoogle({
        userDataPath: temporaryDirectory,
        encryptor: strictEncryptor,
        openExternal: async (url) => {
          const redirectUri = new URL(url).searchParams.get('redirect_uri')!;
          await httpGet(`${redirectUri}/?error=access_denied`);
        },
        fetchImpl: tokenFetch({}),
        timeoutMs: 5000,
      }),
    ).rejects.toThrow('cancelled');
  });

  it('refuses sign-in with no client configured', async () => {
    await expect(
      signInWithGoogle({
        userDataPath: temporaryDirectory,
        encryptor: strictEncryptor,
        openExternal: async () => undefined,
        fetchImpl: tokenFetch({}),
        timeoutMs: 5000,
      }),
    ).rejects.toThrow('not set up');
  });

  it('revokes on sign-out but clears locally even when revocation fails', async () => {
    await saveGoogleClient(temporaryDirectory, strictEncryptor, {
      clientId: 'cid',
      clientSecret: 'csecret',
    });
    await saveGoogleRefreshToken(temporaryDirectory, strictEncryptor, 'rt-1');
    const revoked: string[] = [];
    const fetchImpl: GoogleApiFetch = async (url, init) => {
      revoked.push(init?.body ?? '');
      expect(url).toContain('/revoke');
      return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
    };
    await signOutWithGoogle({
      userDataPath: temporaryDirectory,
      encryptor: strictEncryptor,
      fetchImpl,
    });
    expect(new URLSearchParams(revoked[0]).get('token')).toBe('rt-1');
    expect((await loadGoogleAuth(temporaryDirectory, strictEncryptor)).refreshToken).toBeUndefined();
    await saveGoogleRefreshToken(temporaryDirectory, strictEncryptor, 'rt-2');
    await signOutWithGoogle({
      userDataPath: temporaryDirectory,
      encryptor: strictEncryptor,
      fetchImpl: async () => {
        throw new Error('Network down');
      },
    });
    expect((await loadGoogleAuth(temporaryDirectory, strictEncryptor)).refreshToken).toBeUndefined();
  });
});

describe('google access token refresh', () => {
  it('refreshes and preserves the old refresh token when none is returned', async () => {
    vi.resetModules();
    const fresh = await import('../../electron/auth/google-auth');
    await saveGoogleClient(temporaryDirectory, strictEncryptor, {
      clientId: 'cid',
      clientSecret: 'csecret',
    });
    await fresh.saveGoogleRefreshToken(temporaryDirectory, strictEncryptor, 'rt-old');
    const token = await fresh.getGoogleAccessToken({
      userDataPath: temporaryDirectory,
      encryptor: strictEncryptor,
      fetchImpl: tokenFetch({ access_token: 'at-new', expires_in: 3600 }),
    });
    expect(token).toBe('at-new');
    expect((await fresh.loadGoogleAuth(temporaryDirectory, strictEncryptor)).refreshToken).toBe(
      'rt-old',
    );
  });

  it('stores a rotated refresh token when one is returned', async () => {
    vi.resetModules();
    const fresh = await import('../../electron/auth/google-auth');
    await saveGoogleClient(temporaryDirectory, strictEncryptor, {
      clientId: 'cid',
      clientSecret: 'csecret',
    });
    await fresh.saveGoogleRefreshToken(temporaryDirectory, strictEncryptor, 'rt-old');
    await fresh.getGoogleAccessToken({
      userDataPath: temporaryDirectory,
      encryptor: strictEncryptor,
      fetchImpl: tokenFetch({ access_token: 'at-new', refresh_token: 'rt-new', expires_in: 3600 }),
    });
    expect((await fresh.loadGoogleAuth(temporaryDirectory, strictEncryptor)).refreshToken).toBe(
      'rt-new',
    );
  });

  it('reuses a cached unexpired access token without refreshing', async () => {
    vi.resetModules();
    const fresh = await import('../../electron/auth/google-auth');
    await fresh.saveGoogleClient(temporaryDirectory, strictEncryptor, {
      clientId: 'cid',
      clientSecret: 'csecret',
    });
    await fresh.signInWithGoogle({
      userDataPath: temporaryDirectory,
      encryptor: strictEncryptor,
      openExternal: async (url) => {
        const redirectUri = new URL(url).searchParams.get('redirect_uri')!;
        await httpGet(`${redirectUri}/?code=test-code`);
      },
      fetchImpl: tokenFetch({ access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600 }),
      timeoutMs: 5000,
    });
    const token = await fresh.getGoogleAccessToken({
      userDataPath: temporaryDirectory,
      encryptor: strictEncryptor,
      fetchImpl: async () => {
        throw new Error('Refresh must not be called for a cached token.');
      },
    });
    expect(token).toBe('at-1');
  });
});
