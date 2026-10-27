// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearAppleAppPassword,
  getAppleAuthStatus,
  getAppleCredentials,
  listAppleCalendarChoices,
  loadAppleAuth,
  saveAppleSignIn,
  verifyAppleCalendar,
  type AppleAuthEncryptor,
} from '../../electron/auth/apple-auth';
import type { AppleTransportFetch } from '../shared/apple-transport';

const strictEncryptor: AppleAuthEncryptor = {
  isAvailable: () => true,
  encrypt: (plaintext) => Buffer.from(`enc:${plaintext}`),
  decrypt: (ciphertext) => {
    const text = ciphertext.toString();
    if (!text.startsWith('enc:')) throw new Error('Cannot decrypt.');
    return text.slice(4);
  },
};

const unavailableEncryptor: AppleAuthEncryptor = {
  isAvailable: () => false,
  encrypt: () => Buffer.from(''),
  decrypt: () => '',
};

let temporaryDirectory = '';

beforeEach(async () => {
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'a11y-apple-auth-'));
});

afterEach(async () => {
  await rm(temporaryDirectory, { recursive: true, force: true });
});

describe('apple auth storage and verify', () => {
  it('round-trips the Apple ID and password, and clears only the password on sign-out', async () => {
    await saveAppleSignIn(temporaryDirectory, strictEncryptor, {
      appleId: 'test@icloud.com',
      appPassword: 'abcd-efgh',
    });
    expect(await loadAppleAuth(temporaryDirectory, strictEncryptor)).toEqual({
      appleId: 'test@icloud.com',
      appPassword: 'abcd-efgh',
    });
    expect(
      await getAppleAuthStatus({ userDataPath: temporaryDirectory, encryptor: strictEncryptor }),
    ).toEqual({ configured: true, signedIn: true });
    await clearAppleAppPassword(temporaryDirectory);
    expect(await loadAppleAuth(temporaryDirectory, strictEncryptor)).toEqual({
      appleId: 'test@icloud.com',
    });
    expect(
      await getAppleAuthStatus({ userDataPath: temporaryDirectory, encryptor: strictEncryptor }),
    ).toEqual({ configured: true, signedIn: false });
  });

  it('refuses setup without secure storage and requires both fields', async () => {
    await expect(
      saveAppleSignIn(temporaryDirectory, unavailableEncryptor, {
        appleId: 'test@icloud.com',
        appPassword: 'abcd-efgh',
      }),
    ).rejects.toThrow('Secure storage is not available');
    await expect(
      saveAppleSignIn(temporaryDirectory, strictEncryptor, { appleId: '  ', appPassword: 'pw' }),
    ).rejects.toThrow('Apple ID is required');
  });

  it('verifies through discovery and fails when not signed in', async () => {
    await expect(
      verifyAppleCalendar({
        userDataPath: temporaryDirectory,
        encryptor: strictEncryptor,
        fetchImpl: async () => ({ ok: true, status: 207, text: async () => '' }),
      }),
    ).rejects.toThrow('Not signed in');
    await saveAppleSignIn(temporaryDirectory, strictEncryptor, {
      appleId: 'test@icloud.com',
      appPassword: 'abcd-efgh',
    });
    const fetchImpl: AppleTransportFetch = async (url) => {
      let body = '';
      if (url === 'https://caldav.icloud.com/') {
        body =
          '<D:multistatus xmlns:D="DAV:"><D:response><D:propstat><D:prop>' +
          '<D:current-user-principal><D:href>/1/principals/users/test/</D:href></D:current-user-principal>' +
          '</D:prop></D:propstat></D:response></D:multistatus>';
      } else if (url === 'https://caldav.icloud.com/1/principals/users/test/') {
        body =
          '<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:response><D:propstat><D:prop>' +
          '<C:calendar-home-set><D:href>/1/calendars/</D:href></C:calendar-home-set>' +
          '</D:prop></D:propstat></D:response></D:multistatus>';
      } else {
        body =
          '<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:response>' +
          '<D:href>/1/calendars/main/</D:href><D:propstat><D:prop>' +
          '<D:resourcetype><D:collection /><C:calendar /></D:resourcetype>' +
          '<D:displayname>Calendar</D:displayname>' +
          '<C:supported-calendar-component-set><C:comp name="VEVENT" /></C:supported-calendar-component-set>' +
          '</D:prop></D:propstat></D:response></D:multistatus>';
      }
      return { ok: true, status: 207, text: async () => body };
    };
    await expect(
      verifyAppleCalendar({ userDataPath: temporaryDirectory, encryptor: strictEncryptor, fetchImpl }),
    ).resolves.toEqual({ calendarName: 'Calendar' });
    expect(
      await getAppleCredentials({ userDataPath: temporaryDirectory, encryptor: strictEncryptor }),
    ).toEqual({ appleId: 'test@icloud.com', appPassword: 'abcd-efgh' });
  });

  it('lists calendar names and URLs for the picker', async () => {
    await saveAppleSignIn(temporaryDirectory, strictEncryptor, {
      appleId: 'test@icloud.com',
      appPassword: 'abcd-efgh',
    });
    const fetchImpl: AppleTransportFetch = async (url) => {
      let body = '';
      if (url === 'https://caldav.icloud.com/') {
        body =
          '<D:multistatus xmlns:D="DAV:"><D:response><D:propstat><D:prop>' +
          '<D:current-user-principal><D:href>/1/principals/users/test/</D:href></D:current-user-principal>' +
          '</D:prop></D:propstat></D:response></D:multistatus>';
      } else if (url === 'https://caldav.icloud.com/1/principals/users/test/') {
        body =
          '<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:response><D:propstat><D:prop>' +
          '<C:calendar-home-set><D:href>/1/calendars/</D:href></C:calendar-home-set>' +
          '</D:prop></D:propstat></D:response></D:multistatus>';
      } else {
        body =
          '<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">' +
          '<D:response><D:href>/1/calendars/main/</D:href><D:propstat><D:prop>' +
          '<D:resourcetype><D:collection /><C:calendar /></D:resourcetype>' +
          '<D:displayname>Calendar</D:displayname>' +
          '<C:supported-calendar-component-set><C:comp name="VEVENT" /></C:supported-calendar-component-set>' +
          '</D:prop></D:propstat></D:response>' +
          '<D:response><D:href>/1/calendars/family/</D:href><D:propstat><D:prop>' +
          '<D:resourcetype><D:collection /><C:calendar /></D:resourcetype>' +
          '<D:displayname>Family</D:displayname>' +
          '<C:supported-calendar-component-set><C:comp name="VEVENT" /></C:supported-calendar-component-set>' +
          '</D:prop></D:propstat></D:response></D:multistatus>';
      }
      return { ok: true, status: 207, text: async () => body };
    };
    await expect(
      listAppleCalendarChoices({
        userDataPath: temporaryDirectory,
        encryptor: strictEncryptor,
        fetchImpl,
      }),
    ).resolves.toEqual([
      { name: 'Calendar', url: 'https://caldav.icloud.com/1/calendars/main/' },
      { name: 'Family', url: 'https://caldav.icloud.com/1/calendars/family/' },
    ]);
  });
});
