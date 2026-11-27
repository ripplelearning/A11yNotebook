import { describe, expect, it } from 'vitest';
import { buildEmailMessage } from '../../electron/vault/email-message';

describe('buildEmailMessage', () => {
  it('marks the message as an unsent draft with X-Unsent: 1 as the first header', () => {
    const message = buildEmailMessage('Meeting notes.md', Buffer.from('hello', 'utf8'));
    const lines = message.split('\r\n');
    expect(lines[0]).toBe('X-Unsent: 1');
    expect(lines).toContain('Subject: Meeting notes.md');
    expect(lines).toContain('MIME-Version: 1.0');
    expect(lines.some((line) => line.startsWith('Content-Type: multipart/mixed; boundary="'))).toBe(true);
  });

  it('keeps the attachment and body intact', () => {
    const bytes = Buffer.from('note contents', 'utf8');
    const message = buildEmailMessage('note.md', bytes);
    expect(message).toContain('Attached: note.md');
    expect(message).toContain(bytes.toString('base64'));
    expect(message).toContain('Content-Disposition: attachment; filename="note.md"');
  });

  it('encodes a non-ASCII subject as an RFC 2047 encoded word', () => {
    const message = buildEmailMessage('Réunion.md', Buffer.from('x', 'utf8'));
    const subject = message.split('\r\n').find((line) => line.startsWith('Subject: '));
    expect(subject).toBe(
      `Subject: =?UTF-8?B?${Buffer.from('Réunion.md', 'utf8').toString('base64')}?=`,
    );
    expect(message.split('\r\n')[0]).toBe('X-Unsent: 1');
  });
});
