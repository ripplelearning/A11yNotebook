// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parsePptxDeck } from '../../electron/vault/pptx-parser';
import { parseOdpDeck } from '../../electron/vault/odp-parser';
import { zip } from './test-zip';

const presentationNs = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const drawingNs = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const relNs = 'http://schemas.openxmlformats.org/package/2006/relationships';
const relsNs = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function pptxEntries(): Record<string, string> {
  return {
    'ppt/presentation.xml':
      `<p:presentation xmlns:p="${presentationNs}" xmlns:r="${relsNs}"><p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId3"/></p:sldIdLst></p:presentation>`,
    'ppt/_rels/presentation.xml.rels':
      `<Relationships xmlns="${relNs}"><Relationship Id="rId2" Type="${relsNs}/slide" Target="slides/slide1.xml"/><Relationship Id="rId3" Type="${relsNs}/slide" Target="slides/slide2.xml"/></Relationships>`,
    'ppt/slides/slide1.xml':
      `<p:sld xmlns:p="${presentationNs}" xmlns:a="${drawingNs}"><p:cSld><p:spTree>` +
      `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Budget Review</a:t></a:r></a:p></p:txBody></p:sp>` +
      `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Content"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>First point</a:t></a:r></a:p><a:p><a:r><a:t>Second point</a:t></a:r></a:p></p:txBody></p:sp>` +
      `</p:spTree></p:cSld></p:sld>`,
    'ppt/slides/_rels/slide1.xml.rels':
      `<Relationships xmlns="${relNs}"><Relationship Id="rId1" Type="${relsNs}/notesSlide" Target="../notesSlides/notesSlide1.xml"/></Relationships>`,
    'ppt/notesSlides/notesSlide1.xml':
      `<p:notes xmlns:p="${presentationNs}" xmlns:a="${drawingNs}"><p:cSld><p:spTree>` +
      `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image"/><p:cNvSpPr/><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr></p:sp>` +
      `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Remember the Q3 numbers.</a:t></a:r></a:p></p:txBody></p:sp>` +
      `</p:spTree></p:cSld></p:notes>`,
    'ppt/slides/slide2.xml':
      `<p:sld xmlns:p="${presentationNs}" xmlns:a="${drawingNs}"><p:cSld><p:spTree>` +
      `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Content"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Only body</a:t></a:r></a:p></p:txBody></p:sp>` +
      `</p:spTree></p:cSld></p:sld>`,
  };
}

const officeNs = 'urn:oasis:names:tc:opendocument:xmlns:office:1.0';
const drawNs = 'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0';
const presentationOdpNs = 'urn:oasis:names:tc:opendocument:xmlns:presentation:1.0';
const textNs = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0';

function odpEntries(): Record<string, string> {
  return {
    'content.xml':
      `<office:document-content xmlns:office="${officeNs}" xmlns:draw="${drawNs}" xmlns:presentation="${presentationOdpNs}" xmlns:text="${textNs}" office:version="1.2">` +
      '<office:body><office:presentation>' +
      '<draw:page draw:name="page1">' +
      '<draw:frame presentation:class="title"><draw:text-box><text:p>Budget Review</text:p></draw:text-box></draw:frame>' +
      '<draw:frame presentation:class="outline"><draw:text-box><text:p>First point</text:p><text:p>Second point</text:p></draw:text-box></draw:frame>' +
      '<presentation:notes><draw:frame><draw:text-box><text:p>Remember the Q3 numbers.</text:p></draw:text-box></draw:frame></presentation:notes>' +
      '</draw:page>' +
      '<draw:page draw:name="page2">' +
      '<draw:frame presentation:class="outline"><draw:text-box><text:p>Only body</text:p></draw:text-box></draw:frame>' +
      '</draw:page>' +
      '</office:presentation></office:body></office:document-content>',
  };
}

describe('pptx parser', () => {
  it('reads titles, body text, and speaker notes in slide order', () => {
    const deck = parsePptxDeck(zip(pptxEntries()));
    expect(deck.sourceFormat).toBe('pptx');
    expect(deck.slides).toHaveLength(2);
    const first = deck.slides[0];
    expect(first.title).toBe('Budget Review');
    expect(first.blocks).toEqual([
      { kind: 'title', text: 'Budget Review' },
      { kind: 'body', text: 'First point\nSecond point' },
    ]);
    expect(first.notes).toBe('Remember the Q3 numbers.');
    const second = deck.slides[1];
    expect(second.title).toBe('');
    expect(second.blocks).toEqual([{ kind: 'body', text: 'Only body' }]);
    expect(second.notes).toBe('');
  });

  it('rejects a deck without slides', () => {
    expect(() => parsePptxDeck(zip({}))).toThrow('presentation.xml is missing');
    const entries = pptxEntries();
    entries['ppt/presentation.xml'] =
      `<p:presentation xmlns:p="${presentationNs}" xmlns:r="${relsNs}"><p:sldIdLst></p:sldIdLst></p:presentation>`;
    expect(() => parsePptxDeck(zip(entries))).toThrow('contains no slides');
  });
});

describe('odp parser', () => {
  it('reads titles, body text, and speaker notes in page order', () => {
    const deck = parseOdpDeck(zip(odpEntries()));
    expect(deck.sourceFormat).toBe('odp');
    expect(deck.slides).toHaveLength(2);
    const first = deck.slides[0];
    expect(first.title).toBe('Budget Review');
    expect(first.blocks).toEqual([
      { kind: 'title', text: 'Budget Review' },
      { kind: 'body', text: 'First point\nSecond point' },
    ]);
    expect(first.notes).toBe('Remember the Q3 numbers.');
    const second = deck.slides[1];
    expect(second.title).toBe('');
    expect(second.blocks).toEqual([{ kind: 'body', text: 'Only body' }]);
    expect(second.notes).toBe('');
  });

  it('rejects a file without a presentation', () => {
    expect(() => parseOdpDeck(zip({}))).toThrow('content.xml is missing');
    expect(() =>
      parseOdpDeck(
        zip({
          'content.xml': `<office:document-content xmlns:office="${officeNs}" office:version="1.2"><office:body></office:body></office:document-content>`,
        }),
      ),
    ).toThrow('contains no presentation');
  });
});
