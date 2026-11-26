import { randomUUID } from 'node:crypto';

/**
 * Build the MIME message the app writes to a temp .eml file and opens in
 * the default mail app, with the file embedded as an attachment.
 *
 * The first header, `X-Unsent: 1`, marks the message as an unsent draft.
 * Without it, mail clients treat the file as a received message and open
 * it read-only (no editable To/Cc/Subject/body, no Send). With it, clients
 * that honor the convention — Outlook, Thunderbird, Windows Mail — open it
 * in compose mode with the attachment present, so the user can address the
 * message and press Send. It is a widely honored convention, not an RFC
 * standard header; clients that ignore it simply open the message as
 * before. The header must come first: some clients only treat the file as
 * a draft when it is the first header line.
 */
export function buildEmailMessage(name: string, bytes: Buffer): string {
  const boundary = `a11y-notebook-${randomUUID()}`;
  const safeName = name.replace(/["\r\n]/g, '-');
  const encodedName = encodeURIComponent(name).replace(/[!()*']/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  const subject = /^[\x20-\x7e]*$/.test(name)
    ? name
    : `=?UTF-8?B?${Buffer.from(name, 'utf8').toString('base64')}?=`;
  const base64 = bytes.toString('base64');
  const wrapped: string[] = [];
  for (let offset = 0; offset < base64.length; offset += 76) wrapped.push(base64.slice(offset, offset + 76));
  return [
    'X-Unsent: 1',
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 7bit',
    '',
    `Attached: ${name}`,
    '',
    `--${boundary}`,
    'Content-Type: application/octet-stream',
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename="${safeName}"; filename*=UTF-8''${encodedName}`,
    '',
    ...wrapped,
    `--${boundary}--`,
    '',
  ].join('\r\n');
}
