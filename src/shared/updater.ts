// Updater status model shared by the main process and the renderer.
// This module must stay free of Node/Electron imports.

export type UpdaterStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'update-available'; version: string; releaseName?: string; releaseNotes: string }
  | { state: 'update-not-available'; version: string }
  | { state: 'download-progress'; percent: number }
  | { state: 'update-downloaded'; version: string }
  | { state: 'unsupported'; message: string }
  | { state: 'error'; message: string };

export type UpdaterState = UpdaterStatus['state'];

export const UPDATES_DEV_BUILD_MESSAGE = 'Updates are only available in the installed build.';
export const UPDATES_PORTABLE_MESSAGE =
  'Automatic updates are not available in the portable version. Download the latest installer from the GitHub Releases page.';

const MAX_RELEASE_NOTES_LENGTH = 600;
const MAX_ERROR_LENGTH = 300;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** Runtime validation for status messages received over IPC. */
export function isUpdaterStatus(value: unknown): value is UpdaterStatus {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  switch (candidate.state) {
    case 'idle':
    case 'checking':
      return true;
    case 'update-available':
      return (
        isNonEmptyString(candidate.version) &&
        typeof candidate.releaseNotes === 'string' &&
        (candidate.releaseName === undefined || typeof candidate.releaseName === 'string')
      );
    case 'update-not-available':
    case 'update-downloaded':
      return isNonEmptyString(candidate.version);
    case 'download-progress':
      return (
        typeof candidate.percent === 'number' &&
        Number.isFinite(candidate.percent) &&
        candidate.percent >= 0 &&
        candidate.percent <= 100
      );
    case 'unsupported':
    case 'error':
      return isNonEmptyString(candidate.message);
    default:
      return false;
  }
}

/** Clamp and round a raw download percentage to a whole number between 0 and 100. */
export function normalizePercent(percent: number): number {
  if (!Number.isFinite(percent)) {
    return 0;
  }
  return Math.min(100, Math.max(0, Math.round(percent)));
}

/**
 * Progress is announced in 10 percent steps so screen reader users are not
 * flooded with an announcement for every progress event.
 */
export function progressAnnouncementBucket(percent: number): number {
  return Math.floor(normalizePercent(percent) / 10) * 10;
}

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: ' ',
  quot: '"',
  apos: "'",
  lt: '<',
  gt: '>',
};

function decodeEntities(text: string): string {
  return (
    text
      .replace(/&(nbsp|quot|apos|lt|gt);/g, (_match, name: string) => NAMED_ENTITIES[name])
      .replace(/&#(\d+);/g, (_match, code: string) => {
        const value = Number(code);
        return value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : '';
      })
      // Decode &amp; last so sequences such as "&amp;lt;" are not double-decoded.
      .replace(/&amp;/g, '&')
  );
}

type ReleaseNoteEntry = { version?: string; note?: string | null };

/**
 * GitHub release notes arrive as HTML (or, for multi-version updates, as a list).
 * Convert them to a short plain-text summary. The result is only ever rendered as
 * text content, never as HTML.
 */
export function summarizeReleaseNotes(
  notes: string | ReleaseNoteEntry[] | null | undefined,
  maxLength = MAX_RELEASE_NOTES_LENGTH,
): string {
  const raw = Array.isArray(notes)
    ? notes
        .map((entry) => entry.note ?? '')
        .filter(Boolean)
        .join('\n')
    : (notes ?? '');

  let text = raw.replace(/<\s*(br|\/p|\/li|\/h[1-6])\s*\/?>/gi, ' ');
  let previous: string;
  do {
    previous = text;
    text = text.replace(/<[^<>]*>/g, ' ');
  } while (text !== previous);
  text = text.replace(/[<>]/g, ' ');
  text = decodeEntities(text).replace(/\s+/g, ' ').trim();

  if (text.length > maxLength) {
    text = `${text.slice(0, maxLength - 1).trimEnd()}…`;
  }
  return text;
}

/** Turn an unknown updater error into a short, readable, user-facing message. */
export function formatUpdaterError(error: unknown): string {
  const rawMessage =
    error instanceof Error ? error.message : typeof error === 'string' ? error : 'An unknown error occurred.';
  // Rejected ipcRenderer.invoke calls are prefixed with "Error invoking remote method '<channel>': ".
  const raw = rawMessage.replace(/^Error invoking remote method '[^']*':\s*(?:Error:\s*)?/, '');
  const firstLine = raw.split(/\r?\n/)[0]?.trim() ?? '';

  if (/ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ERR_CONNECTION/i.test(raw)) {
    return 'Could not reach GitHub. Check your internet connection and try again.';
  }
  if (/\b404\b|No published versions|Cannot find latest\.yml/i.test(raw)) {
    return 'No published release was found on GitHub yet. A tagged release must be published before updates can be installed.';
  }
  if (/signature|not signed|publisherName/i.test(raw)) {
    return 'The downloaded update could not be verified and was not installed.';
  }
  if (/\b(403|429)\b|rate limit/i.test(raw)) {
    return 'GitHub is temporarily limiting requests. Please try again later.';
  }

  const message = firstLine || 'An unknown error occurred.';
  return message.length > MAX_ERROR_LENGTH ? `${message.slice(0, MAX_ERROR_LENGTH - 1)}…` : message;
}

/** A short sentence describing a status, suitable for the status bar and live regions. */
export function describeUpdaterStatus(status: UpdaterStatus): string {
  switch (status.state) {
    case 'idle':
      return '';
    case 'checking':
      return 'Checking for updates.';
    case 'update-available':
      return `Update available: version ${status.version}.`;
    case 'update-not-available':
      return `You are using the latest version (${status.version}).`;
    case 'download-progress':
      return status.percent <= 0
        ? 'Downloading update.'
        : `Downloading update: ${normalizePercent(status.percent)} percent complete.`;
    case 'update-downloaded':
      return `Version ${status.version} has been downloaded and is ready to install.`;
    case 'unsupported':
      return status.message;
    case 'error':
      return `Update error: ${status.message}`;
  }
}
