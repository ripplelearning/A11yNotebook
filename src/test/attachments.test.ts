import { describe, expect, it } from 'vitest';
import { protocolPath } from '../../electron/vault/attachments';
import { imageUrl, parseCsv } from '../shared/attachments';

describe('attachment boundary and CSV', () => {
  it('round trips encoded filenames', () => {
    expect(protocolPath(imageUrl('Photos/Photo #1.png'))).toBe('Photos/Photo #1.png');
  });
  it.each([
    'vault-file://attachment/../secret.png',
    'vault-file://attachment/%2e%2e/secret.png',
    'vault-file://attachment/A%2Fsecret.png',
    'vault-file://attachment/A%5Csecret.png',
    'vault-file://attachment/C%3A/secret.png',
    'vault-file://attachment/%00.png',
    'vault-file://other/test.png',
    'vault-file://attachment/test.png?path=secret',
    'vault-file://attachment/%zz',
  ])('rejects invalid protocol URL %s', (url) => expect(() => protocolPath(url)).toThrow());
  it('parses commas, escaped quotes and multiline cells', () => {
    expect(parseCsv('Title,Text\r\nA,"one,two"\r\nB,"line\n""quote"""')).toEqual([
      ['Title', 'Text'],
      ['A', 'one,two'],
      ['B', 'line\n"quote"'],
    ]);
    expect(() => parseCsv('"unterminated')).toThrow();
  });
});
