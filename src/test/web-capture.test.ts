// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { htmlToMarkdown, validateCaptureUrl } from '../../electron/vault/web-capture';

describe('web capture conversion and URL validation', () => {
  it('preserves headings, emphasis, safe links and downloaded local images', () => {
    const html =
      '<h1>Research</h1><p>A <strong>bold</strong> &amp; useful page &amp;lt;safe&amp;gt;.</p><a href="/source">Read source</a><script>steal()</script><img src="/photo.png" alt="Photo"><img src="https://remote.example/image.png">';
    const output = htmlToMarkdown(
      html,
      'https://example.org/page',
      new Map([['https://example.org/photo.png', 'Attachments/Capture-1/image-1.png']]),
    );
    expect(output).toContain('# Research');
    expect(output).toContain('**bold** & useful page &lt;safe&gt;.');
    expect(output).toContain('&lt;safe&gt;');
    expect(output).toContain('[Read source](https://example.org/source)');
    expect(output).toContain('![Photo](Attachments/Capture-1/image-1.png)');
    expect(output).not.toContain('steal');
    expect(output).not.toContain('remote.example');
  });

  it('accepts only public HTTPS URLs without credentials or nonstandard ports', () => {
    expect(validateCaptureUrl('https://example.org/article')).toBe('https://example.org/article');
    for (const url of [
      'http://example.org/',
      'https://localhost/',
      'https://127.0.0.1/',
      '******example.org/',
      'https://example.org:8443/',
    ]) {
      expect(() => validateCaptureUrl(url)).toThrow();
    }
  });
});
