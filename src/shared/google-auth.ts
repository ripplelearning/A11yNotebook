/**
 * Pure Google OAuth pieces for the sync sign-in flow: authorization URL,
 * redirect parsing, code exchange, and token refresh. No Electron APIs, no
 * storage: the main-process wrapper owns the browser, the loopback server,
 * and the encrypted token file, and passes fetch in so these functions stay
 * unit-testable.
 *
 * The flow is the standard Desktop-app (installed-app) flow: the system
 * browser opens Google's consent page, Google redirects to a loopback
 * address (http://127.0.0.1:<port>) with an authorization code, and the app
 * exchanges that code for tokens. access_type=offline plus prompt=consent
 * requests a refresh token, so the app can mint new access tokens without
 * asking the user to sign in again. Google may omit the refresh token on
 * refresh responses; callers keep the previous one in that case.
 */

export const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar';
export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

/** 60 seconds of clock-skew buffer before an access token counts as expired. */
const EXPIRY_BUFFER_MS = 60_000;

export interface GoogleAuthClient {
  clientId: string;
  clientSecret: string;
}

export interface GoogleTokenSet {
  accessToken: string;
  refreshToken?: string;
  /** Epoch milliseconds when the access token expires. */
  expiresAt: number;
  scope?: string;
}

export interface GoogleApiFetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export type GoogleApiFetch = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<GoogleApiFetchResponse>;

export function buildGoogleAuthUrl(clientId: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_CALENDAR_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

export type GoogleRedirectResult = { ok: true; code: string } | { ok: false; error: string };

/** Parse the loopback redirect Google sends after consent or denial. */
export function parseGoogleRedirect(url: string): GoogleRedirectResult {
  let params: URLSearchParams;
  try {
    params = new URL(url).searchParams;
  } catch {
    return { ok: false, error: 'invalid_redirect' };
  }
  const error = params.get('error');
  if (error) return { ok: false, error };
  const code = params.get('code');
  if (!code) return { ok: false, error: 'missing_code' };
  return { ok: true, code };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function postToken(
  body: Record<string, string>,
  fetchImpl: GoogleApiFetch,
): Promise<Record<string, unknown>> {
  const response = await fetchImpl(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(
      `Google token request failed (${response.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`,
    );
  }
  const data = await response.json().catch(() => null);
  if (!isRecord(data)) throw new Error('Google token response was not an object.');
  return data;
}

function toTokenSet(data: Record<string, unknown>, nowMs: number): GoogleTokenSet {
  if (typeof data.access_token !== 'string' || !data.access_token) {
    throw new Error('Google token response had no access token.');
  }
  const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : 3600;
  const tokenSet: GoogleTokenSet = {
    accessToken: data.access_token,
    expiresAt: nowMs + expiresIn * 1000,
  };
  if (typeof data.refresh_token === 'string' && data.refresh_token) {
    tokenSet.refreshToken = data.refresh_token;
  }
  if (typeof data.scope === 'string' && data.scope) tokenSet.scope = data.scope;
  return tokenSet;
}

export async function exchangeGoogleCode(input: {
  client: GoogleAuthClient;
  code: string;
  redirectUri: string;
  fetchImpl: GoogleApiFetch;
  nowMs?: number;
}): Promise<GoogleTokenSet> {
  const data = await postToken(
    {
      grant_type: 'authorization_code',
      code: input.code,
      client_id: input.client.clientId,
      client_secret: input.client.clientSecret,
      redirect_uri: input.redirectUri,
    },
    input.fetchImpl,
  );
  return toTokenSet(data, input.nowMs ?? Date.now());
}

export async function refreshGoogleToken(input: {
  client: GoogleAuthClient;
  refreshToken: string;
  fetchImpl: GoogleApiFetch;
  nowMs?: number;
}): Promise<GoogleTokenSet> {
  const data = await postToken(
    {
      grant_type: 'refresh_token',
      refresh_token: input.refreshToken,
      client_id: input.client.clientId,
      client_secret: input.client.clientSecret,
    },
    input.fetchImpl,
  );
  return toTokenSet(data, input.nowMs ?? Date.now());
}

export function isGoogleTokenExpired(token: GoogleTokenSet, nowMs: number = Date.now()): boolean {
  return token.expiresAt - EXPIRY_BUFFER_MS <= nowMs;
}
