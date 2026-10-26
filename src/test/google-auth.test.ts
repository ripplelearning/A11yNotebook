import { describe, expect, it, vi } from 'vitest';
import {
  buildGoogleAuthUrl,
  exchangeGoogleCode,
  isGoogleTokenExpired,
  parseGoogleRedirect,
  refreshGoogleToken,
  type GoogleApiFetch,
} from '../shared/google-auth';

function tokenResponse(data: Record<string, unknown>) {
  return {
    ok: true,
    status: 200,
    json: async () => data,
    text: async () => JSON.stringify(data),
  };
}

describe('google auth pieces', () => {
  it('builds an offline-access consent URL', () => {
    const url = new URL(buildGoogleAuthUrl('client-1', 'http://127.0.0.1:9000'));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('client_id')).toBe('client-1');
    expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:9000');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/calendar');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
  });

  it('parses redirect results, including denial and garbage', () => {
    expect(parseGoogleRedirect('http://127.0.0.1:9000/?code=abc')).toEqual({
      ok: true,
      code: 'abc',
    });
    expect(parseGoogleRedirect('http://127.0.0.1:9000/?error=access_denied')).toEqual({
      ok: false,
      error: 'access_denied',
    });
    expect(parseGoogleRedirect('http://127.0.0.1:9000/')).toEqual({
      ok: false,
      error: 'missing_code',
    });
    expect(parseGoogleRedirect('not a url')).toEqual({ ok: false, error: 'invalid_redirect' });
  });

  it('exchanges a code with a form-encoded token request', async () => {
    const bodies: string[] = [];
    const fetchImpl: GoogleApiFetch = vi.fn(async (_url, init) => {
      bodies.push(init?.body ?? '');
      return tokenResponse({
        access_token: 'at-1',
        refresh_token: 'rt-1',
        expires_in: 3600,
        scope: 'https://www.googleapis.com/auth/calendar',
      });
    });
    const tokens = await exchangeGoogleCode({
      client: { clientId: 'cid', clientSecret: 'csecret' },
      code: 'code-1',
      redirectUri: 'http://127.0.0.1:9000',
      fetchImpl,
      nowMs: 1000,
    });
    expect(tokens).toEqual({
      accessToken: 'at-1',
      refreshToken: 'rt-1',
      expiresAt: 1000 + 3600 * 1000,
      scope: 'https://www.googleapis.com/auth/calendar',
    });
    const params = new URLSearchParams(bodies[0]);
    expect(params.get('grant_type')).toBe('authorization_code');
    expect(params.get('code')).toBe('code-1');
    expect(params.get('client_id')).toBe('cid');
    expect(params.get('client_secret')).toBe('csecret');
    expect(params.get('redirect_uri')).toBe('http://127.0.0.1:9000');
  });

  it('rejects token errors and token responses without an access token', async () => {
    const failing: GoogleApiFetch = async () => ({
      ok: false,
      status: 400,
      json: async () => ({}),
      text: async () => 'invalid_grant',
    });
    await expect(
      exchangeGoogleCode({
        client: { clientId: 'cid', clientSecret: 'csecret' },
        code: 'bad',
        redirectUri: 'http://127.0.0.1:9000',
        fetchImpl: failing,
      }),
    ).rejects.toThrow('400');
    const empty: GoogleApiFetch = async () => tokenResponse({ expires_in: 3600 });
    await expect(
      exchangeGoogleCode({
        client: { clientId: 'cid', clientSecret: 'csecret' },
        code: 'code-1',
        redirectUri: 'http://127.0.0.1:9000',
        fetchImpl: empty,
      }),
    ).rejects.toThrow('no access token');
  });

  it('refreshes without requiring a new refresh token', async () => {
    const fetchImpl: GoogleApiFetch = async (_url, init) => {
      expect(new URLSearchParams(init?.body ?? '').get('grant_type')).toBe('refresh_token');
      return tokenResponse({ access_token: 'at-2', expires_in: 1800 });
    };
    const tokens = await refreshGoogleToken({
      client: { clientId: 'cid', clientSecret: 'csecret' },
      refreshToken: 'rt-old',
      fetchImpl,
      nowMs: 5000,
    });
    expect(tokens.accessToken).toBe('at-2');
    expect(tokens.refreshToken).toBeUndefined();
    expect(tokens.expiresAt).toBe(5000 + 1800 * 1000);
  });

  it('treats tokens expiring within a minute as expired', () => {
    const now = 10_000;
    expect(isGoogleTokenExpired({ accessToken: 'x', expiresAt: now + 30_000 }, now)).toBe(true);
    expect(isGoogleTokenExpired({ accessToken: 'x', expiresAt: now + 120_000 }, now)).toBe(false);
    expect(isGoogleTokenExpired({ accessToken: 'x', expiresAt: now - 1000 }, now)).toBe(true);
  });
});
