// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { sanitizeHtmlFragment, standaloneHtml } from '../../electron/vault/html-sanitize';

describe('main-process standalone HTML sanitization', () => {
  it('keeps semantic structures and task metadata but removes active content and remote resources', () => {
    const safe = sanitizeHtmlFragment(
      '<h1 onclick="run()">Title</h1><script><img src="https://bad.example/x.png"></script><form><input></form><p><a href="javascript:run()">Text</a></p><img src="https://bad.example/p.png" alt="Remote"><ul><li data-a11y-task-id="task-1234" data-a11y-task-complete="false" onmouseover="run()">Item</li></ul>',
    );
    expect(safe).toContain('<h1>Title</h1>');
    expect(safe).toContain('data-a11y-task-id="task-1234"');
    expect(safe).not.toContain('<script');
    expect(safe).not.toContain('<form');
    expect(safe).not.toContain('javascript:');
    expect(safe).not.toContain('https://bad.example');
    expect(safe).not.toContain('onmouseover');
  });

  it('canonicalizes captured links and localizes only downloaded raster images', () => {
    const safe = sanitizeHtmlFragment(
      '<h2>News</h2><table><tbody><tr><th scope="col">Name</th><td>Value</td></tr></tbody></table><a href="../source">Source</a><img src="/photo.png" alt="Photo"><img src="https://remote.example/unknown.png" alt="Missing">',
      {
        allowVaultImages: true,
        baseUrl: 'https://example.org/articles/page',
        imageReferences: new Map([['https://example.org/photo.png', 'Attachments/Capture/image.png']]),
      },
    );
    expect(safe).toContain('<a href="https://example.org/source">');
    expect(safe).toContain('src="Attachments/Capture/image.png"');
    expect(safe).toContain('Missing');
    expect(safe).not.toContain('https://remote.example');
    expect(safe).toContain('<table>');
  });

  it('wraps output in a restrictive policy without scripts or network resources', () => {
    const output = standaloneHtml('Research <note>', sanitizeHtmlFragment('<p>Safe</p>'));
    expect(output).toContain("default-src 'none'");
    expect(output).toContain('<title>Research &lt;note&gt;</title>');
    expect(output).toContain('<p>Safe</p>');
  });
});
