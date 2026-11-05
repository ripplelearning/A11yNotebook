/**
 * Standalone links: one `.url` file per link in a notebook, shown in the
 * Notes and Files grid with Type "Link". The file format is the Windows
 * Internet Shortcut format, so the same file also opens in a browser when
 * double-clicked outside the app. A link is a grid item only: creating or
 * editing one never writes into a note.
 */

/** The extension of a link file. */
export const LINK_FILE_EXTENSION = '.url';

/** Schemes a link may point to, matching the open-URL allowlist. */
const ALLOWED_LINK_SCHEMES = new Set(['http:', 'https:', 'mailto:']);

/** True when the value parses as a URL with an allowed scheme. */
export function isAllowedLinkUrl(value: string): boolean {
  try {
    return ALLOWED_LINK_SCHEMES.has(new URL(value.trim()).protocol);
  } catch {
    return false;
  }
}

/** True when the value parses as a web URL (http/https only). */
export function isWebUrl(value: string): boolean {
  try {
    const protocol = new URL(value.trim()).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/** True when the path is a link file. */
export function isLinkPath(value: string): boolean {
  return value.toLowerCase().endsWith(LINK_FILE_EXTENSION);
}

/** Serialize a link file: one `[InternetShortcut]` section with a `URL=` line. */
export function formatLinkFile(url: string): string {
  return `[InternetShortcut]\r\nURL=${url.trim()}\r\n`;
}

/**
 * Read the URL back out of a link file. Tolerates LF or CRLF line endings
 * and extra lines (for example an `IconFile=` line added by another app).
 * Returns null when no `URL=` line is present.
 */
export function parseLinkUrl(content: string): string | null {
  const match = /^\s*URL\s*=\s*(.+?)\s*$/im.exec(content);
  return match ? match[1] : null;
}

/**
 * Read the URL out of a Google link-pointer file (.gdoc, .gsheet,
 * .gslides). Pointer files are JSON with a `url` field. Returns null when
 * the file is not valid pointer JSON or the URL is not a web URL.
 */
export function parsePointerFileUrl(content: string): string | null {
  try {
    const parsed: unknown = JSON.parse(content);
    if (!parsed || typeof parsed !== 'object') return null;
    const url = (parsed as Record<string, unknown>).url;
    if (typeof url !== 'string' || !isWebUrl(url)) return null;
    return url.trim();
  } catch {
    return null;
  }
}

const ILLEGAL_FILE_NAME_CHARACTERS = /[<>:"/\\|?*\u0000-\u001f]/g;

/**
 * Turn a typed link title into a link file name. Illegal file-name
 * characters become '-', surrounding whitespace is trimmed, and an empty
 * title falls back to "Link". The result always ends with `.url`.
 */
export function linkFileName(title: string): string {
  const stem = title
    .replace(ILLEGAL_FILE_NAME_CHARACTERS, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
  return `${stem || 'Link'}${LINK_FILE_EXTENSION}`;
}
