// @vitest-environment node
import { get } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildOutlookAuthUrl,
  exchangeOutlookCode,
  isOutlookTokenExpired,
  parseOutlookRedirect,
  refreshOutlookToken,
  type OutlookApiFetch,
} from '../shared/outlook-auth';
import {
  createPkcePair,
  getOutlookAuthStatus,
  listenForOutlookRedirect,
  loadOutlookAuth,
  saveOutlookClient,
  saveOutlookRefreshToken,
  signInWithOutlook,
  signOutWithOutlook,
  type OutlookAuthEncryptor,
} from '../../electron/auth/outlook-auth';

const strictEncryptor: OutlookAuthEncryptor = {
  isAvailable: () => true,
  encrypt: (plaintext) => Buffer.from(`enc:${plaintext}`),
  decrypt: (ciphertext) => {
    const text = ciphertext.toString();
    if (!text.startsWith('enc:')) throw new Error('Cannot decrypt.');
    return text.slice(4);
  },
};

const unavailableEncryptor: OutlookAuthEncryptor = {
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

function tokenFetch(data: Record<string, unknown>): OutlookApiFetch {
  return async () => ({
    ok: true,
    status: 200,
    json: async () => data,
    text: async () => JSON.stringify(data),
  });
}

let temporaryDirectory = '';

beforeEach(async () => {
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'a11y-outlook-auth-'));
});

afterEach(async () => {
  await rm(temporaryDirectory, { recursive: true, force: true });
});

describe('outlook auth pure pieces', () => {
  it('builds a PKCE authorization URL with the calendar scope', () => {
    const url = new URL(buildOutlookAuthUrl('cid', 'http://127.0.0.1:1234', 'challenge-1'));
    expect(url.hostname).toBe('login.microsoftonline.com');
    expect(url.searchParams.get('client_id')).toBe('cid');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('code_challenge')).toBe('challenge-1');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope')).toContain('Calendars.ReadWrite');
    expect(url.searchParams.get('scope')).toContain('offline_access');
    expect(url.searchParams.get('client_secret')).toBeNull();
  });

  it('parses redirects, denials, and malformed URLs', () => {
    expect(parseOutlookRedirect('http://127.0.0.1:9/?code=abc')).toEqual({ ok: true, code: 'abc' });
    expect(parseOutlookRedirect('http://127.0.0.1:9/?error=access_denied')).toEqual({
      ok: false,
      error: 'access_denied',
    });
    expect(parseOutlookRedirect('not a url')).toEqual({ ok: false, error: 'invalid_redirect' });
    expect(parseOutlookRedirect('http://127.0.0.1:9/')).toEqual({ ok: false, error: 'missing_code' });
  });

  it('exchanges codes with the verifier and refreshes without a secret', async () => {
    const seen: string[] = [];
    const fetchImpl: OutlookApiFetch = async (url, init) => {
      seen.push(init.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600 }),
        text: async () => '',
      };
    };
    const tokens = await exchangeOutlookCode({
      client: { clientId: 'cid' },
      code: 'code-1',
      redirectUri: 'http://127.0.0.1:9',
      codeVerifier: 'verifier-1',
      fetchImpl,
      nowMs: 1000,
    });
    expect(tokens).toMatchObject({ accessToken: 'at-1', refreshToken: 'rt-1', expiresAt: 3601000 });
    expect(seen[0]).toContain('code_verifier=verifier-1');
    expect(seen[0]).not.toContain('client_secret');
    const refreshed = await refreshOutlookToken({
      client: { clientId: 'cid' },
      refreshToken: 'rt-1',
      fetchImpl,
      nowMs: 2000,
    });
    expect(refreshed.accessToken).toBe('at-1');
    expect(isOutlookTokenExpired({ accessToken: 'at-1', expiresAt: 3601000 }, 3540999)).toBe(false);
    expect(isOutlookTokenExpired({ accessToken: 'at-1', expiresAt: 3601000 }, 3541000)).toBe(true);
  });

  it('creates a verifier/challenge pair whose challenge is the S256 hash', async () => {
    const { createHash } = await import('node:crypto');
    const pair = createPkcePair();
    expect(pair.verifier.length).toBeGreaterThanOrEqual(43);
    expect(pair.challenge).toBe(createHash('sha256').update(pair.verifier).digest('base64url'));
  });
});

describe('outlook auth storage and flow', () => {
  it('round-trips the client id and refresh token, and clears only the token on sign-out', async () => {
    await saveOutlookClient(temporaryDirectory, strictEncryptor, { clientId: 'cid' });
    await saveOutlookRefreshToken(temporaryDirectory, strictEncryptor, 'rt-1');
    expect(await loadOutlookAuth(temporaryDirectory, strictEncryptor)).toEqual({
      client: { clientId: 'cid' },
      refreshToken: 'rt-1',
    });
    expect(
      await getOutlookAuthStatus({ userDataPath: temporaryDirectory, encryptor: strictEncryptor }),
    ).toEqual({ configured: true, signedIn: true });
    await signOutWithOutlook({ userDataPath: temporaryDirectory, encryptor: strictEncryptor });
    expect(await loadOutlookAuth(temporaryDirectory, strictEncryptor)).toEqual({
      client: { clientId: 'cid' },
    });
  });

  it('refuses setup without secure storage', async () => {
    await expect(
      saveOutlookClient(temporaryDirectory, unavailableEncryptor, { clientId: 'cid' }),
    ).rejects.toThrow('Secure storage is not available');
  });

  it('signs in through the loopback redirect and cancels cleanly on denial', async () => {
    await saveOutlookClient(temporaryDirectory, strictEncryptor, { clientId: 'cid' });
    const opened: string[] = [];
    const fetchImpl = tokenFetch({ access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600 });
    const signIn = signInWithOutlook({
      userDataPath: temporaryDirectory,
      encryptor: strictEncryptor,
      openExternal: async (url) => {
        opened.push(url);
        const redirect = new URL(url).searchParams.get('redirect_uri')!;
        await httpGet(`${redirect}/?code=code-1`);
      },
      fetchImpl,
    });
    await expect(signIn).resolves.toEqual({ signedIn: true });
    expect(opened[0]).toContain('login.microsoftonline.com');
    expect(await loadOutlookAuth(temporaryDirectory, strictEncryptor)).toMatchObject({
      refreshToken: 'rt-1',
    });

    const denied = signInWithOutlook({
      userDataPath: temporaryDirectory,
      encryptor: strictEncryptor,
      openExternal: async (url) => {
        const redirect = new URL(url).searchParams.get('redirect_uri')!;
        await httpGet(`${redirect}/?error=access_denied`);
      },
      fetchImpl,
    });
    await expect(denied).rejects.toThrow('cancelled');
  });

  it('ignores favicon requests and times out a silent sign-in', async () => {
    const listener = await listenForOutlookRedirect(50);
    await httpGet(`${listener.redirectUri}/favicon.ico`);
    await expect(listener.wait()).rejects.toThrow('timed out');
    listener.close();
  });

  it('returns a cached token and refreshes from storage when it expires', async () => {
    await saveOutlookClient(temporaryDirectory, strictEncryptor, { clientId: 'cid' });
    await saveOutlookRefreshToken(temporaryDirectory, strictEncryptor, 'rt-1');
    vi.resetModules();
    const fresh = await import('../../electron/auth/outlook-auth');
    const calls: string[] = [];
    const fetchImpl: OutlookApiFetch = async (url, init) => {
      calls.push(init.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'at-2', expires_in: 3600 }),
        text: async () => '',
      };
    };
    const token = await fresh.getOutlookAccessToken({
      userDataPath: temporaryDirectory,
      encryptor: strictEncryptor,
      fetchImpl,
    });
    expect(token).toBe('at-2');
    expect(calls[0]).toContain('grant_type=refresh_token');
    expect(calls[0]).toContain('refresh_token=rt-1');
    const cached = await fresh.getOutlookAccessToken({
      userDataPath: temporaryDirectory,
      encryptor: strictEncryptor,
      fetchImpl: async () => {
        throw new Error('Should not fetch when cached.');
      },
    });
    expect(cached).toBe('at-2');
  });
});
