import { describe, expect, it } from 'vitest';
import {
  describeUpdaterStatus,
  formatUpdaterError,
  isUpdaterStatus,
  normalizePercent,
  progressAnnouncementBucket,
  summarizeReleaseNotes,
} from '../shared/updater';

describe('updater status validation', () => {
  it('accepts well-formed statuses', () => {
    expect(isUpdaterStatus({ state: 'checking' })).toBe(true);
    expect(isUpdaterStatus({ state: 'update-available', version: '1.2.0', releaseNotes: '' })).toBe(true);
    expect(isUpdaterStatus({ state: 'download-progress', percent: 42 })).toBe(true);
    expect(isUpdaterStatus({ state: 'error', message: 'Oops' })).toBe(true);
  });

  it('rejects malformed or unknown statuses', () => {
    expect(isUpdaterStatus(null)).toBe(false);
    expect(isUpdaterStatus('checking')).toBe(false);
    expect(isUpdaterStatus({ state: 'run-arbitrary-code' })).toBe(false);
    expect(isUpdaterStatus({ state: 'update-available', version: 1 })).toBe(false);
    expect(isUpdaterStatus({ state: 'download-progress', percent: 150 })).toBe(false);
    expect(isUpdaterStatus({ state: 'error', message: '' })).toBe(false);
  });
});

describe('progress announcements', () => {
  it('rounds and clamps percentages', () => {
    expect(normalizePercent(42.6)).toBe(43);
    expect(normalizePercent(-5)).toBe(0);
    expect(normalizePercent(120)).toBe(100);
    expect(normalizePercent(Number.NaN)).toBe(0);
  });

  it('groups progress into 10 percent steps', () => {
    expect(progressAnnouncementBucket(0)).toBe(0);
    expect(progressAnnouncementBucket(9.9)).toBe(10);
    expect(progressAnnouncementBucket(9.4)).toBe(0);
    expect(progressAnnouncementBucket(57)).toBe(50);
    expect(progressAnnouncementBucket(100)).toBe(100);
  });

  it('describes statuses in plain language', () => {
    expect(describeUpdaterStatus({ state: 'download-progress', percent: 30 })).toBe(
      'Downloading update: 30 percent complete.',
    );
    expect(describeUpdaterStatus({ state: 'update-available', version: '2.0.0', releaseNotes: '' })).toBe(
      'Update available: version 2.0.0.',
    );
  });
});

describe('release notes', () => {
  it('converts HTML release notes to plain text', () => {
    expect(summarizeReleaseNotes('<h2>Fixes</h2><ul><li>Better &amp; faster</li><li>F6 &lt;works&gt;</li></ul>')).toBe(
      'Fixes Better & faster F6 <works>',
    );
  });

  it('removes nested or broken markup', () => {
    const text = summarizeReleaseNotes('<scr<script>ipt>alert(1)</script> safe');
    expect(text).not.toContain('<script');
    expect(text).toContain('safe');
  });

  it('joins multi-version notes and truncates long notes', () => {
    expect(summarizeReleaseNotes([{ note: 'One' }, { note: null }, { note: 'Two' }])).toBe('One Two');
    const long = summarizeReleaseNotes('a'.repeat(1000), 50);
    expect(long).toHaveLength(50);
    expect(long.endsWith('…')).toBe(true);
    expect(summarizeReleaseNotes(undefined)).toBe('');
  });
});

describe('updater error formatting', () => {
  it('maps network errors to a readable message', () => {
    expect(formatUpdaterError(new Error('net::ERR_INTERNET_DISCONNECTED'))).toMatch(/internet connection/);
  });

  it('explains when no release has been published', () => {
    expect(formatUpdaterError(new Error('HttpError: 404 Not Found\n"method: GET url: ..."'))).toMatch(
      /No published release/,
    );
  });

  it('strips the Electron IPC prefix from rejected invoke errors', () => {
    expect(
      formatUpdaterError(new Error("Error invoking remote method 'updater:check': Error: Untrusted updater request.")),
    ).toBe('Untrusted updater request.');
  });

  it('keeps only the first line of other errors', () => {
    expect(formatUpdaterError(new Error('Something broke\n    at stack frame'))).toBe('Something broke');
    expect(formatUpdaterError(undefined)).toBe('An unknown error occurred.');
  });
});
