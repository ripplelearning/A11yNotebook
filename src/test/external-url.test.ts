// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { validateExternalUrl } from '../../electron/vault/external-url';

describe('external Markdown URL validation', () => {
  it.each([
    ['http://example.com', 'http://example.com/'],
    ['https://example.com/page', 'https://example.com/page'],
    ['mailto:notes@example.com', 'mailto:notes@example.com'],
  ])('allows %s', (url, normalizedUrl) => {
    expect(validateExternalUrl(url)).toBe(normalizedUrl);
  });

  it.each(['javascript:alert(1)', 'file:///etc/passwd', '******example.com', 'not a URL', null])(
    'rejects %s',
    (url) => {
      expect(() => validateExternalUrl(url)).toThrow();
    },
  );
});
