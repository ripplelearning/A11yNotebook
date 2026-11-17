import { describe, expect, it } from 'vitest';
import {
  defaultPasteImageName,
  extractPastedImageDescription,
  firstLinePasteName,
  pasteContentExtension,
  pasteImageExtension,
  plainTextToHtml,
  relativeLibraryPath,
  sanitizePasteFileStem,
} from '../shared/paste-content';

describe('paste-content helpers', () => {
  it('names a text paste from its first line, stripping Markdown markers', () => {
    expect(firstLinePasteName('# Shopping list\n\n- milk\n- bread')).toBe('Shopping list');
    expect(firstLinePasteName('\n\n  1. First task\n  2. Second')).toBe('First task');
    expect(firstLinePasteName('- [ ] Call the dentist')).toBe('[ ] Call the dentist');
    expect(firstLinePasteName('   \n\n')).toBe('Pasted text');
    expect(firstLinePasteName('Bad/name? here')).toBe('Bad-name- here');
  });

  it('sanitizes a file-name stem', () => {
    expect(sanitizePasteFileStem('  Report: Q4  ')).toBe('Report- Q4');
    expect(sanitizePasteFileStem('...')).toBe('');
    expect(sanitizePasteFileStem('a'.repeat(150))).toHaveLength(100);
  });

  it('names a pasted picture from its clipboard name, falling back to Pasted image', () => {
    expect(defaultPasteImageName('screenshot.png')).toBe('screenshot');
    expect(defaultPasteImageName('')).toBe('Pasted image');
    expect(defaultPasteImageName(undefined)).toBe('Pasted image');
    expect(defaultPasteImageName('image.png')).toBe('Pasted image');
  });

  it('maps stored formats and image types to extensions', () => {
    expect(pasteContentExtension('markdown')).toBe('.md');
    expect(pasteContentExtension('html')).toBe('.html');
    expect(pasteContentExtension('txt')).toBe('.txt');
    expect(pasteImageExtension('image/png')).toBe('.png');
    expect(pasteImageExtension('image/jpeg')).toBe('.jpg');
    expect(pasteImageExtension('image/svg+xml')).toBeNull();
    expect(pasteImageExtension('text/plain')).toBeNull();
  });

  it('wraps plain text as HTML paragraphs', () => {
    expect(plainTextToHtml('Hello <world>\n\nSecond paragraph\nwith two lines')).toBe(
      '<p>Hello &lt;world&gt;</p>\n<p>Second paragraph<br>with two lines</p>',
    );
    expect(plainTextToHtml('   ')).toBe('');
  });

  it('keeps a copied picture description from the image alt text', () => {
    expect(
      extractPastedImageDescription(
        '<html><body><!--StartFragment--><img src="https://example.com/dot.jpg" alt="A red dot on white"><!--EndFragment--></body></html>',
      ),
    ).toBe('A red dot on white');
    expect(extractPastedImageDescription('<p><img src="dot.png" alt="  Spaced out  "></p>')).toBe('Spaced out');
    expect(extractPastedImageDescription('<p><img src="dot.png" alt="Fish &amp; Chips"></p>')).toBe('Fish & Chips');
    expect(extractPastedImageDescription('<p>No picture here.</p>')).toBeUndefined();
    expect(extractPastedImageDescription('')).toBeUndefined();
  });

  it('falls back to the figure caption when the image has no alt text', () => {
    expect(
      extractPastedImageDescription(
        '<figure><img src="https://example.com/dot.jpg"><figcaption>A red dot on white, captioned</figcaption></figure>',
      ),
    ).toBe('A red dot on white, captioned');
    // An empty alt means decorative: the caption is the description.
    expect(
      extractPastedImageDescription(
        '<figure><img src="dot.jpg" alt=""><figcaption>Caption wins</figcaption></figure>',
      ),
    ).toBe('Caption wins');
    // Alt text wins over the caption when the source provides both.
    expect(
      extractPastedImageDescription(
        '<figure><img src="dot.jpg" alt="Alt wins"><figcaption>Caption loses</figcaption></figure>',
      ),
    ).toBe('Alt wins');
    // No alt and no caption anywhere: nothing to keep.
    expect(extractPastedImageDescription('<p><img src="dot.jpg"></p>')).toBeUndefined();
  });

  it('expresses a stored picture path relative to its note', () => {
    expect(relativeLibraryPath('Seeded', 'Seeded/Pasted image.png')).toBe('Pasted image.png');
    expect(relativeLibraryPath('Seeded/Sub', 'Seeded/Pasted image.png')).toBe('../Pasted image.png');
    expect(relativeLibraryPath('Seeded', 'Other/Pasted image.png')).toBe('../Other/Pasted image.png');
  });
});
