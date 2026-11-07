import { describe, expect, it } from 'vitest';
import {
  describePointerFileProblem,
  formatLinkFile,
  isAllowedLinkUrl,
  isLinkPath,
  isWebUrl,
  linkFileName,
  parseLinkUrl,
  parsePointerFileUrl,
} from '../shared/links';

describe('link files', () => {
  it('round-trips a URL through the .url file format', () => {
    const url = 'https://example.com/docs/guide';
    expect(parseLinkUrl(formatLinkFile(url))).toBe(url);
  });

  it('parses the URL line with LF endings and extra lines', () => {
    const content = '[InternetShortcut]\nURL=https://example.com/page\nIconFile=icon.ico\n';
    expect(parseLinkUrl(content)).toBe('https://example.com/page');
  });

  it('returns null when no URL line is present', () => {
    expect(parseLinkUrl('[InternetShortcut]\n')).toBeNull();
    expect(parseLinkUrl('')).toBeNull();
  });

  it('allows http, https, and mailto links and rejects the rest', () => {
    expect(isAllowedLinkUrl('https://example.com')).toBe(true);
    expect(isAllowedLinkUrl('http://example.com')).toBe(true);
    expect(isAllowedLinkUrl('mailto:someone@example.com')).toBe(true);
    expect(isAllowedLinkUrl('ftp://example.com/file')).toBe(false);
    expect(isAllowedLinkUrl('file:///etc/passwd')).toBe(false);
    expect(isAllowedLinkUrl('javascript:alert(1)')).toBe(false);
    expect(isAllowedLinkUrl('/relative/path')).toBe(false);
    expect(isAllowedLinkUrl('not a url')).toBe(false);
  });

  it('accepts only web URLs for pointer files', () => {
    expect(isWebUrl('https://docs.google.com/document/d/abc')).toBe(true);
    expect(isWebUrl('mailto:someone@example.com')).toBe(false);
  });

  it('recognizes link paths case-insensitively', () => {
    expect(isLinkPath('Research/Example.URL')).toBe(true);
    expect(isLinkPath('Research/Example.url')).toBe(true);
    expect(isLinkPath('Research/Example.md')).toBe(false);
  });

  it('reads the URL out of Google pointer files', () => {
    const gdoc = JSON.stringify({ url: 'https://docs.google.com/document/d/abc123/edit', resource_id: 'abc123' });
    expect(parsePointerFileUrl(gdoc)).toBe('https://docs.google.com/document/d/abc123/edit');
  });

  it('rejects pointer files without a usable web URL', () => {
    expect(parsePointerFileUrl(JSON.stringify({ url: 'ftp://example.com/file' }))).toBeNull();
    expect(parsePointerFileUrl(JSON.stringify({}))).toBeNull();
    expect(parsePointerFileUrl('not json')).toBeNull();
  });

  it('tolerates a UTF-8 byte-order mark before pointer JSON', () => {
    const gdoc = `\uFEFF${JSON.stringify({ url: 'https://docs.google.com/document/d/abc123/edit' })}`;
    expect(parsePointerFileUrl(gdoc)).toBe('https://docs.google.com/document/d/abc123/edit');
  });

  it('names the specific pointer-file problem for each failure', () => {
    expect(describePointerFileProblem('')).toBe('The file is empty.');
    expect(describePointerFileProblem('   ')).toBe('The file is empty.');
    expect(describePointerFileProblem('not json')).toBe('The file does not contain valid link data.');
    expect(describePointerFileProblem(JSON.stringify({ resource_id: 'abc' }))).toBe(
      'The file does not contain a web address.',
    );
    expect(describePointerFileProblem(JSON.stringify({ url: 'ftp://example.com/file' }))).toBe(
      'The web address in the file is not an http or https address.',
    );
    expect(
      describePointerFileProblem(JSON.stringify({ url: 'https://docs.google.com/document/d/abc123/edit' })),
    ).toBeNull();
  });

  it('turns a typed title into a safe link file name', () => {
    expect(linkFileName('Example Site')).toBe('Example Site.url');
    expect(linkFileName('  A/B: C?  ')).toBe('A-B- C-.url');
    expect(linkFileName('')).toBe('Link.url');
    expect(linkFileName('   ')).toBe('Link.url');
  });
});
