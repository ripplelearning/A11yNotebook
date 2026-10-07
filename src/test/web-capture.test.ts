// @vitest-environment node
import { EventEmitter } from 'node:events';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { request, type RequestOptions } from 'node:https';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { captureWebPage, htmlToMarkdown, validateCaptureUrl } from '../../electron/vault/web-capture';
import { sanitizeHtmlFragment } from '../../electron/vault/html-sanitize';

const { lookup } = vi.hoisted(() => ({
  lookup: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]),
}));
vi.mock('node:dns/promises', () => ({ lookup }));
vi.mock('node:https', () => ({ request: vi.fn() }));

beforeEach(() => vi.clearAllMocks());

async function beginCapture() {
  const outgoing = Object.assign(new EventEmitter(), {
    end: vi.fn(),
    destroy: vi.fn((error: Error) => {
      outgoing.emit('error', error);
      outgoing.emit('close');
      return outgoing;
    }),
  });
  vi.mocked(request).mockReturnValue(outgoing as unknown as ClientRequest);
  const result = captureWebPage('https://example.org/article');
  await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
  const [options, callback] = vi.mocked(request).mock.calls[0] as unknown as [
    RequestOptions,
    (response: IncomingMessage) => void,
  ];
  const response = Object.assign(new EventEmitter(), {
    statusCode: 200,
    headers: { 'content-type': 'text/html' },
  });
  callback(response as unknown as IncomingMessage);
  return { result, options, response, outgoing };
}

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
    expect(
      htmlToMarkdown(
        '<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>',
        'https://example.org',
      ),
    ).toContain('| A | B |');
    expect(htmlToMarkdown('<table><tr><td>a\\b|c</td></tr></table>', 'https://example.org')).toContain(
      '| a\\\\b\\|c |',
    );
  });

  it('sanitizes capture HTML and keeps a partial-image notice in the saved representation', async () => {
    const { result, response, outgoing } = await beginCapture();
    response.emit(
      'data',
      Buffer.from(
        '<title>Research</title><h1>Research</h1><script>steal()</script><form><input></form><a href="../source">Read</a><img src="https://example.org/missing.png">',
      ),
    );
    response.emit('end');
    outgoing.emit('close');
    await expect(result).resolves.toMatchObject({
      sourceUrl: 'https://example.org/article',
      omittedImages: 1,
      html: expect.stringContaining('Capture notice'),
      markdown: expect.stringContaining('Capture notice'),
    });
    const capture = await result;
    expect(capture.html).toContain('<h1>Research</h1>');
    expect(capture.html).toContain('https://example.org/source');
    expect(capture.html).not.toContain('<script');
    expect(capture.html).not.toContain('<form');
    expect(capture.html).not.toContain('steal()');
  });

  it('retains accessible headings, table structure, safe links, and localized raster references', () => {
    const safe = sanitizeHtmlFragment(
      '<h2>Section</h2><table><tr><th scope="col">A</th><td>B</td></tr></table><a href="../link">Link</a><img src="/image.png" alt="Chart">',
      {
        allowVaultImages: true,
        baseUrl: 'https://example.org/page/',
        imageReferences: new Map([['https://example.org/image.png', 'Attachments/Capture/image.png']]),
      },
    );
    expect(safe).toContain('<h2>Section</h2>');
    expect(safe).toContain('<table>');
    expect(safe).toContain('href="https://example.org/link"');
    expect(safe).toContain('src="Attachments/Capture/image.png" alt="Chart"');
  });

  describe('bounded HTTPS downloads', () => {
    it('pins the validated address family and downloads an HTML page', async () => {
      const { result, options, response, outgoing } = await beginCapture();
      expect(options.family).toBe(4);
      const callback = vi.fn();
      options.lookup!('example.org', {}, callback);
      expect(callback).toHaveBeenCalledWith(null, '93.184.216.34', 4);
      response.emit('data', Buffer.from('<title>Research</title><h1>Research</h1>'));
      response.emit('end');
      outgoing.emit('close');
      await expect(result).resolves.toMatchObject({
        title: 'Research',
        markdown: expect.stringContaining('# Research'),
      });
    });

    it.each(['error', 'aborted'])('rejects an interrupted response (%s)', async (event) => {
      const { result, response, outgoing } = await beginCapture();
      const rejected = expect(result).rejects.toThrow(/interrupted/);
      response.emit(event, new Error('Download interrupted'));
      outgoing.emit('close');
      await rejected;
    });

    it('enforces a deadline even when a server keeps sending data', async () => {
      vi.useFakeTimers();
      try {
        const { result, response } = await beginCapture();
        const rejected = expect(result).rejects.toThrow(/timed out/);
        await vi.advanceTimersByTimeAsync(6_000);
        response.emit('data', Buffer.from('partial'));
        await vi.advanceTimersByTimeAsync(6_000);
        await rejected;
      } finally {
        vi.useRealTimers();
      }
    });
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

  it.each([
    '192.0.0.8',
    '192.0.2.1',
    '198.51.100.1',
    '203.0.113.1',
    '192.88.99.1',
    '198.18.0.1',
    '100.64.0.1',
    '240.0.0.1',
    '[2001:db8::1]',
    '[2001:2::1]',
    '[2002:7f00:1::]',
    '[4000::1]',
    '[64:ff9b::a00:1]',
    '[::ffff:192.0.2.1]',
    '[::ffff:c000:201]',
  ])('rejects special-purpose literal addresses (%s)', (address) => {
    expect(() => validateCaptureUrl(`https://${address}/`)).toThrow(/public/);
  });

  it.each(['192.0.2.1', '198.51.100.1', '203.0.113.1', '2001:db8::1', '::ffff:c000:201'])(
    'rejects DNS results containing a non-public address (%s) before requesting',
    async (address) => {
      lookup.mockResolvedValueOnce([
        { address: '93.184.216.34', family: 4 },
        { address, family: address.includes(':') ? 6 : 4 },
      ]);
      await expect(captureWebPage('https://example.org/article')).rejects.toThrow(/public address/);
      expect(request).not.toHaveBeenCalled();
    },
  );

  it('accepts a public IPv6 literal', () => {
    expect(validateCaptureUrl('https://[2606:4700:4700::1111]/')).toBe('https://[2606:4700:4700::1111]/');
  });
});
