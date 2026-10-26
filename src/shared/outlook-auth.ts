/**
 * Pure Microsoft identity platform pieces for Outlook Calendar sync:
 * authorization URL (public native client with PKCE, no client secret),
 * redirect parsing, code exchange, refresh, and expiry. No network or
 * Electron APIs here beyond the injected fetch: the main-process module
 * supplies storage, the loopback server, and the browser opener.
 */

export const OUTLOOK_AUTH_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
export const OUTLOOK_TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
export const OUTLOOK_CALENDAR_SCOPE = 'https://graph.microsoft.com/Calendars.ReadWrite offline_access';
const EXPIRY_BUFFER_MS = 60_000;

export interface OutlookAuthClient {
  clientId: string;
}

export interface OutlookTokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  scope?: string;
}

export interface OutlookApiFetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export type OutlookApiFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<OutlookApiFetchResponse>;

export function buildOutlookAuthUrl(
  clientId: string,
  redirectUri: string,
  codeChallenge: string,
): string {
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: OUTLOOK_CALENDAR_SCOPE,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  return `${OUTLOOK_AUTH_URL}?${params.toString()}`;
}

export type OutlookRedirectResult = { ok: true; code: string } | { ok: false; error: string };

/** Parse the loopback redirect Microsoft sends after consent or denial. */
export function parseOutlookRedirect(url: string): OutlookRedirectResult {
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
  fetchImpl: OutlookApiFetch,
): Promise<Record<string, unknown>> {
  const response = await fetchImpl(OUTLOOK_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(
      `Outlook token request failed (${response.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`,
    );
  }
  const data = await response.json().catch(() => null);
  if (!isRecord(data)) throw new Error('Outlook token response was not an object.');
  return data;
}

function toTokenSet(data: Record<string, unknown>, nowMs: number): OutlookTokenSet {
  if (typeof data.access_token !== 'string' || !data.access_token) {
    throw new Error('Outlook token response had no access token.');
  }
  const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : 3600;
  const tokenSet: OutlookTokenSet = {
    accessToken: data.access_token,
    expiresAt: nowMs + expiresIn * 1000,
  };
  if (typeof data.refresh_token === 'string' && data.refresh_token) {
    tokenSet.refreshToken = data.refresh_token;
  }
  if (typeof data.scope === 'string' && data.scope) tokenSet.scope = data.scope;
  return tokenSet;
}

export async function exchangeOutlookCode(input: {
  client: OutlookAuthClient;
  code: string;
  redirectUri: string;
  codeVerifier: string;
  fetchImpl: OutlookApiFetch;
  nowMs?: number;
}): Promise<OutlookTokenSet> {
  const data = await postToken(
    {
      grant_type: 'authorization_code',
      code: input.code,
      client_id: input.client.clientId,
      redirect_uri: input.redirectUri,
      code_verifier: input.codeVerifier,
    },
    input.fetchImpl,
  );
  return toTokenSet(data, input.nowMs ?? Date.now());
}

export async function refreshOutlookToken(input: {
  client: OutlookAuthClient;
  refreshToken: string;
  fetchImpl: OutlookApiFetch;
  nowMs?: number;
}): Promise<OutlookTokenSet> {
  const data = await postToken(
    {
      grant_type: 'refresh_token',
      refresh_token: input.refreshToken,
      client_id: input.client.clientId,
    },
    input.fetchImpl,
  );
  return toTokenSet(data, input.nowMs ?? Date.now());
}

export function isOutlookTokenExpired(token: OutlookTokenSet, nowMs: number = Date.now()): boolean {
  return token.expiresAt - EXPIRY_BUFFER_MS <= nowMs;
}
