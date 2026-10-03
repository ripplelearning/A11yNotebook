/** Return a safe external URL for the operating system to open. */
export function validateExternalUrl(value: unknown): string {
  if (typeof value !== 'string') throw new Error('URL must be text.');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('External URL is invalid.');
  }
  if (!['http:', 'https:', 'mailto:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('External URL protocol is not supported.');
  }
  return url.href;
}
