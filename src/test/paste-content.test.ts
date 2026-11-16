import { describe, expect, it } from 'vitest';
import {
  defaultPasteImageName,
  firstLinePasteName,
  pasteContentExtension,
  pasteImageExtension,
  plainTextToHtml,
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
});
