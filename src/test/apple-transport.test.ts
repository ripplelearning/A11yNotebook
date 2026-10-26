import { describe, expect, it } from 'vitest';
import {
  AppleTransport,
  discoverAppleCalendar,
  type AppleTransportFetch,
} from '../shared/apple-transport';

const PRINCIPAL_XML =
  '<D:multistatus xmlns:D="DAV:"><D:response><D:href>/</D:href><D:propstat><D:prop>' +
  '<D:current-user-principal><D:href>/123/principals/users/test/</D:href></D:current-user-principal>' +
  '</D:prop></D:propstat></D:response></D:multistatus>';
const HOME_XML =
  '<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:response>' +
  '<D:href>/123/principals/users/test/</D:href><D:propstat><D:prop>' +
  '<C:calendar-home-set><D:href>/123/calendars/</D:href></C:calendar-home-set>' +
  '</D:prop></D:propstat></D:response></D:multistatus>';
const LISTING_XML =
  '<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">' +
  '<D:response><D:href>/123/calendars/tasks/</D:href><D:propstat><D:prop>' +
  '<D:resourcetype><D:collection /><C:calendar /></D:resourcetype>' +
  '<D:displayname>Tasks</D:displayname>' +
  '<C:supported-calendar-component-set><C:comp name="VTODO" /></C:supported-calendar-component-set>' +
  '</D:prop></D:propstat></D:response>' +
  '<D:response><D:href>/123/calendars/main/</D:href><D:propstat><D:prop>' +
  '<D:resourcetype><D:collection /><C:calendar /></D:resourcetype>' +
  '<D:displayname>Calendar</D:displayname>' +
  '<C:supported-calendar-component-set><C:comp name="VEVENT" /></C:supported-calendar-component-set>' +
  '</D:prop></D:propstat></D:response></D:multistatus>';

const DENTIST_ICS =
  'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:dentist-1\r\nDTSTART:20261102T180000Z\r\n' +
  'DTEND:20261102T190000Z\r\nSUMMARY:Dentist\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
const CANCELLED_ICS =
  'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:gone-1\r\nDTSTART:20261103T180000Z\r\n' +
  'STATUS:CANCELLED\r\nSUMMARY:Gone\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';

function escapeXmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function multigetResponse(href: string, ics: string): string {
  return (
    `<D:response xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:href>${href}</D:href>` +
    `<D:propstat><D:prop><C:calendar-data>${escapeXmlText(ics)}</C:calendar-data>` +
    `</D:prop></D:propstat></D:response>`
  );
}

function syncResponse(token: string, entries: { href: string; status: string }[]): string {
  return (
    `<D:multistatus xmlns:D="DAV:"><D:sync-token>${token}</D:sync-token>` +
    entries
      .map(
        (entry) =>
          `<D:response><D:href>${entry.href}</D:href><D:status>HTTP/1.1 ${entry.status}</D:status></D:response>`,
      )
      .join('') +
    `</D:multistatus>`
  );
}

describe('apple caldav discovery', () => {
  it('finds the first VEVENT calendar in the home set', async () => {
    const seen: { url: string; depth: string | undefined }[] = [];
    const fetchImpl: AppleTransportFetch = async (url, init) => {
      seen.push({ url, depth: init?.headers?.Depth });
      let body = '';
      if (url === 'https://caldav.icloud.com/') body = PRINCIPAL_XML;
      else if (url === 'https://caldav.icloud.com/123/principals/users/test/') body = HOME_XML;
      else if (url === 'https://caldav.icloud.com/123/calendars/') body = LISTING_XML;
      else throw new Error(`Unexpected discovery URL: ${url}`);
      return { ok: true, status: 207, text: async () => body };
    };
    const found = await discoverAppleCalendar({
      appleId: 'test@icloud.com',
      appPassword: 'abcd-efgh',
      fetchImpl,
    });
    expect(found).toEqual({
      url: 'https://caldav.icloud.com/123/calendars/main/',
      displayName: 'Calendar',
    });
    expect(seen.map((entry) => entry.depth)).toEqual(['0', '0', '1']);
    const auth = (await fetchImpl('https://caldav.icloud.com/', { method: 'PROPFIND' })).ok;
    expect(auth).toBe(true);
  });

  it('fails plainly when the principal is missing', async () => {
    const fetchImpl: AppleTransportFetch = async () => ({
      ok: true,
      status: 207,
      text: async () => '<D:multistatus xmlns:D="DAV:"></D:multistatus>',
    });
    await expect(
      discoverAppleCalendar({ appleId: 'a@icloud.com', appPassword: 'pw', fetchImpl }),
    ).rejects.toThrow('user principal');
  });
});

describe('apple transport pull and push', () => {
  function transportWithFake(): {
    transport: AppleTransport;
    requests: { method: string; url: string; body: string | undefined; headers: Record<string, string> }[];
  } {
    const requests: {
      method: string;
      url: string;
      body: string | undefined;
      headers: Record<string, string>;
    }[] = [];
    const fetchImpl: AppleTransportFetch = async (url, init) => {
      requests.push({
        method: init?.method ?? 'GET',
        url,
        body: init?.body,
        headers: init?.headers ?? {},
      });
      if (init?.method === 'REPORT' && (init.body ?? '').includes('sync-collection')) {
        if ((init.body ?? '').includes('<C:sync-token>expired</C:sync-token>')) {
          return { ok: false, status: 403, text: async () => 'Forbidden' };
        }
        if ((init.body ?? '').includes('<C:sync-token>tok-1</C:sync-token>')) {
          return {
            ok: true,
            status: 207,
            text: async () =>
              syncResponse('tok-2', [
                { href: '/123/calendars/main/gone-1.ics', status: '404 Not Found' },
              ]),
          };
        }
        return {
          ok: true,
          status: 207,
          text: async () =>
            syncResponse('tok-1', [
              { href: '/123/calendars/main/dentist-1.ics', status: '200 OK' },
              { href: '/123/calendars/main/gone-1.ics', status: '200 OK' },
            ]),
        };
      }
      if (init?.method === 'REPORT') {
        const body = init.body ?? '';
        const parts: string[] = [];
        if (body.includes('dentist-1.ics')) {
          parts.push(multigetResponse('/123/calendars/main/dentist-1.ics', DENTIST_ICS));
        }
        if (body.includes('gone-1.ics')) {
          parts.push(multigetResponse('/123/calendars/main/gone-1.ics', CANCELLED_ICS));
        }
        return {
          ok: true,
          status: 207,
          text: async () =>
            `<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">${parts.join('')}</D:multistatus>`,
        };
      }
      if (init?.method === 'PUT') return { ok: true, status: 201, text: async () => '' };
      if (init?.method === 'DELETE') return { ok: true, status: 204, text: async () => '' };
      throw new Error(`Unexpected request: ${init?.method} ${url}`);
    };
    const transport = new AppleTransport({
      appleId: 'test@icloud.com',
      appPassword: 'abcd-efgh',
      fetchImpl,
      calendarUrl: 'https://caldav.icloud.com/123/calendars/main/',
    });
    return { transport, requests };
  }

  it('pulls a full sync, mapping cancelled events to deletions', async () => {
    const { transport } = transportWithFake();
    const result = await transport.pull();
    expect(result.syncToken).toBe('tok-1');
    expect(result.changes).toHaveLength(2);
    const upsert = result.changes.find((change) => change.kind === 'upsert');
    expect(upsert?.appointment).toMatchObject({ title: 'Dentist', externalId: 'dentist-1' });
    const deleted = result.changes.find((change) => change.kind === 'deleted');
    expect(deleted).toMatchObject({ externalId: 'gone-1' });
  });

  it('pulls incrementally and turns an expired token into a retryable error', async () => {
    const { transport } = transportWithFake();
    const incremental = await transport.pull('tok-1');
    expect(incremental.syncToken).toBe('tok-2');
    expect(incremental.changes).toEqual([{ kind: 'deleted', externalId: 'gone-1' }]);
    await expect(transport.pull('expired')).rejects.toThrow('sync token expired');
  });

  it('pushes creates with a generated uid and deletes by uid', async () => {
    const { transport, requests } = transportWithFake();
    const created = await transport.pushCreate({
      id: 'local-1',
      title: 'New',
      start: '2026-11-05T10:00:00-08:00',
      allDay: false,
    });
    expect(created.externalId).toMatch(/@a11ynotebook$/);
    const put = requests.find((entry) => entry.method === 'PUT');
    expect(put?.url).toContain(`/123/calendars/main/${encodeURIComponent(created.externalId)}.ics`);
    expect(put?.body).toContain(`UID:${created.externalId}`);
    expect(put?.headers['If-None-Match']).toBe('*');
    await transport.pushDelete('dentist-1');
    const del = requests.find((entry) => entry.method === 'DELETE');
    expect(del?.url).toBe('https://caldav.icloud.com/123/calendars/main/dentist-1.ics');
  });

  it('sends Basic auth on every request', async () => {
    const { transport, requests } = transportWithFake();
    await transport.pull();
    expect(requests.length).toBeGreaterThan(0);
    for (const entry of requests) {
      expect(entry.headers.Authorization).toBe(
        `Basic ${Buffer.from('test@icloud.com:abcd-efgh').toString('base64')}`,
      );
    }
  });
});
