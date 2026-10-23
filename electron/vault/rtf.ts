/**
 * Local RTF-to-HTML conversion for import.
 *
 * RTF is a text format, so a bounded single-pass converter can faithfully
 * recover the structure a screen reader needs: paragraphs, headings (from
 * named paragraph styles such as "heading 1"), bold/italic/underline/strike
 * runs, simple bullet and numbered lists, line breaks, and hyperlink fields.
 * Binary destinations (pictures, embedded objects, font and color tables)
 * are skipped by design; images in RTF files are not imported. The output is
 * a fragment that still passes through the vault HTML sanitizer before it is
 * stored, so this converter escapes all text and only emits a small tag set.
 */

interface Run {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  sup: boolean;
  sub: boolean;
  hidden: boolean;
  link?: string;
}

interface Paragraph {
  runs: Run[];
  style: number;
  list: 'bullet' | 'number' | null;
}

interface CharState {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  sup: boolean;
  sub: boolean;
  hidden: boolean;
}

const SKIP_DESTINATIONS = new Set([
  'fonttbl',
  'colortbl',
  'info',
  'pict',
  'object',
  'objdata',
  'stylesheet',
  'listtable',
  'listoverridetable',
  'revtbl',
  'rsidtbl',
  'generator',
  'themedata',
  'colorschememapping',
  'latentstyles',
  'wgrffmtfilter',
  'datastore',
  'mmathPr',
  'header',
  'footer',
  'headerl',
  'headerr',
  'headerf',
  'footerl',
  'footerr',
  'footerf',
  'footnote',
  'annotation',
]);

// Windows-1252 mappings for the 0x80-0x9F range; other bytes map as Latin-1.
const CP1252_HIGH: Record<number, string> = {
  0x80: '€',
  0x82: '‚',
  0x83: 'ƒ',
  0x84: '„',
  0x85: '…',
  0x86: '†',
  0x87: '‡',
  0x88: 'ˆ',
  0x89: '‰',
  0x8a: 'Š',
  0x8b: '‹',
  0x8c: 'Œ',
  0x8e: 'Ž',
  0x91: '‘',
  0x92: '’',
  0x93: '“',
  0x94: '”',
  0x95: '•',
  0x96: '–',
  0x97: '—',
  0x98: '˜',
  0x99: '™',
  0x9a: 'š',
  0x9b: '›',
  0x9c: 'œ',
  0x9e: 'ž',
  0x9f: 'Ÿ',
};

function cp1252Char(byte: number): string {
  return CP1252_HIGH[byte] ?? String.fromCharCode(byte);
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttribute(text: string): string {
  return escapeHtml(text).replace(/"/g, '&quot;');
}

export function isRtfSource(text: string): boolean {
  return /^\uFEFF?\s*\{\\rtf[0-9]/.test(text);
}

/** Map RTF style indexes to heading levels using the document stylesheet. */
function parseStylesheet(source: string): Map<number, string> {
  const styles = new Map<number, string>();
  const start = source.indexOf('\\stylesheet');
  if (start < 0) return styles;
  // The stylesheet group runs from its opening brace; scan a bounded window.
  const open = source.lastIndexOf('{', start);
  if (open < 0) return styles;
  let depth = 0;
  let end = open;
  for (let index = open; index < source.length && index < open + 65536; index += 1) {
    if (source[index] === '{') depth += 1;
    else if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) {
        end = index;
        break;
      }
    }
  }
  const body = source.slice(open, end + 1);
  for (const match of body.matchAll(/\\s(\d+)\s+([^;{}]+);/g)) {
    styles.set(Number(match[1]), match[2].trim().toLowerCase());
  }
  return styles;
}

function headingLevelFor(styleName: string | undefined): number | null {
  if (!styleName) return null;
  const heading = /^heading\s*([1-6])\b/.exec(styleName);
  if (heading) return Number(heading[1]);
  if (styleName === 'title') return 1;
  if (styleName === 'subtitle') return 2;
  return null;
}

const freshCharState = (): CharState => ({
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  sup: false,
  sub: false,
  hidden: false,
});

export function convertRtfToHtml(source: string): string {
  if (!isRtfSource(source)) throw new Error('The selected file is not an RTF document.');
  const styles = parseStylesheet(source);
  const paragraphs: Paragraph[] = [];
  let runs: Run[] = [];
  let charState = freshCharState();
  let paragraphStyle = 0;
  let paragraphList: Paragraph['list'] = null;
  let pendingLink: string | undefined;
  let activeLink: string | undefined;
  let activeLinkDepth = -1;
  let braceDepth = 0;
  let inFieldInstruction = false;
  let fieldInstruction = '';
  let listTextDepth = -1; // brace depth of a \listtext label group being suppressed

  const stack: Array<{ charState: CharState; paragraphStyle: number }> = [];

  const pushText = (text: string) => {
    if (!text) return;
    if (inFieldInstruction) {
      fieldInstruction += text;
      return;
    }
    if (listTextDepth >= 0 && braceDepth >= listTextDepth) return; // list label, not content
    const last = runs.at(-1);
    const link = activeLink;
    if (
      last &&
      last.bold === charState.bold &&
      last.italic === charState.italic &&
      last.underline === charState.underline &&
      last.strike === charState.strike &&
      last.sup === charState.sup &&
      last.sub === charState.sub &&
      last.hidden === charState.hidden &&
      last.link === link &&
      !last.text.endsWith('\n')
    ) {
      last.text += text;
    } else {
      runs.push({ text, ...charState, link });
    }
  };

  const endParagraph = () => {
    paragraphs.push({ runs, style: paragraphStyle, list: paragraphList });
    runs = [];
    paragraphList = null;
  };

  let index = 0;
  const length = source.length;
  let skipDepth = 0; // brace depth while skipping a destination group
  while (index < length) {
    const char = source[index];
    if (skipDepth > 0) {
      if (char === '{') skipDepth += 1;
      else if (char === '}') skipDepth -= 1;
      index += 1;
      continue;
    }
    if (char === '{') {
      // Peek ahead: a group whose first token names a skipped destination.
      const peek = /^[{]\s*(?:\\\*\s*)?\\([a-zA-Z]+)/.exec(source.slice(index, index + 40));
      const firstWord = peek?.[1];
      if (firstWord && SKIP_DESTINATIONS.has(firstWord)) {
        skipDepth = 1;
        index += 1;
        continue;
      }
      braceDepth += 1;
      stack.push({ charState: { ...charState }, paragraphStyle });
      index += 1;
      continue;
    }
    if (char === '}') {
      braceDepth -= 1;
      if (listTextDepth >= 0 && braceDepth < listTextDepth) listTextDepth = -1;
      if (activeLink !== undefined && braceDepth < activeLinkDepth) {
        activeLink = undefined;
        activeLinkDepth = -1;
      }
      const restored = stack.pop();
      if (restored) {
        charState = restored.charState;
        paragraphStyle = restored.paragraphStyle;
      }
      if (inFieldInstruction) {
        inFieldInstruction = false;
        const hyperlink =
          /HYPERLINK\s+"([^"]+)"/i.exec(fieldInstruction) ?? /HYPERLINK\s+(\S+)/i.exec(fieldInstruction);
        if (hyperlink) pendingLink = hyperlink[1];
        fieldInstruction = '';
      }
      index += 1;
      continue;
    }
    if (char === '\\') {
      const rest = source.slice(index + 1);
      const hex = /^'([0-9a-fA-F]{2})/.exec(rest);
      if (hex) {
        pushText(cp1252Char(Number.parseInt(hex[1], 16)));
        index += 4;
        continue;
      }
      const control = /^([a-zA-Z]+)(-?\d+)?[ ]?/.exec(rest);
      if (control) {
        const word = control[1];
        const argument = control[2] === undefined ? undefined : Number(control[2]);
        index += 1 + control[0].length;
        switch (word) {
          case 'par':
            endParagraph();
            break;
          case 'line':
            pushText('\n');
            break;
          case 'tab':
            pushText('\t');
            break;
          case 'pard':
            paragraphStyle = 0;
            paragraphList = null;
            charState = freshCharState();
            break;
          case 'plain':
            charState = freshCharState();
            break;
          case 's':
            if (argument !== undefined) paragraphStyle = argument;
            break;
          case 'b':
            charState.bold = argument !== 0;
            break;
          case 'i':
            charState.italic = argument !== 0;
            break;
          case 'ul':
            charState.underline = argument !== 0;
            break;
          case 'ulnone':
            charState.underline = false;
            break;
          case 'strike':
            charState.strike = argument !== 0;
            break;
          case 'v':
            charState.hidden = argument !== 0;
            break;
          case 'super':
            charState.sup = argument !== 0;
            if (charState.sup) charState.sub = false;
            break;
          case 'sub':
            charState.sub = argument !== 0;
            if (charState.sub) charState.sup = false;
            break;
          case 'nosupersub':
            charState.sup = false;
            charState.sub = false;
            break;
          case 'bullet':
            pushText('•');
            break;
          case 'endash':
            pushText('–');
            break;
          case 'emdash':
            pushText('—');
            break;
          case 'lquote':
            pushText('‘');
            break;
          case 'rquote':
            pushText('’');
            break;
          case 'ldblquote':
            pushText('“');
            break;
          case 'rdblquote':
            pushText('”');
            break;
          case 'ellipsis':
            pushText('…');
            break;
          case 'u': {
            if (argument !== undefined) {
              let code = argument;
              if (code < 0) code += 65536;
              if (code > 0 && code <= 0x10ffff) pushText(String.fromCodePoint(code));
            }
            // Skip the single fallback character (or \'xx escape) that follows.
            if (source[index] === '\\' && source[index + 1] === "'") index += 4;
            else if (index < length && source[index] !== '\\' && source[index] !== '{' && source[index] !== '}')
              index += 1;
            break;
          }
          case 'fldinst':
            inFieldInstruction = true;
            fieldInstruction = '';
            break;
          case 'fldrslt':
            if (pendingLink) {
              activeLink = pendingLink;
              pendingLink = undefined;
              // braceDepth is the depth of the fldrslt group itself (its
              // opening brace was consumed just before this control word);
              // the link ends when that group closes.
              activeLinkDepth = braceDepth;
            }
            break;
          case 'pntext':
            // Legacy list label group follows; mark the paragraph as a list item.
            if (paragraphList === null) paragraphList = 'bullet';
            break;
          case 'listtext':
            // The group holds the list label (for example "1." or a bullet);
            // suppress it and mark the paragraph as a list item.
            if (paragraphList === null) paragraphList = 'bullet';
            listTextDepth = braceDepth;
            break;
          default:
            break;
        }
        continue;
      }
      // Control symbol (single non-letter character).
      const symbol = rest[0];
      index += 2;
      if (symbol === '~') pushText('\u00A0');
      else if (symbol === '{' || symbol === '}' || symbol === '\\') pushText(symbol);
      else if (symbol === '*') {
        // Destination marker: the following control word names the group.
        // The group's opening brace was already consumed, so skipping from
        // depth 1 discards through its matching close brace.
        const destination = /^\\?([a-zA-Z]+)/.exec(source.slice(index));
        if (destination && SKIP_DESTINATIONS.has(destination[1])) skipDepth = 1;
      }
      continue;
    }
    // Plain text run up to the next special character.
    let end = index;
    while (end < length && source[end] !== '{' && source[end] !== '}' && source[end] !== '\\') end += 1;
    let text = source.slice(index, end);
    // RTF line breaks in the source are insignificant.
    text = text.replace(/[\r\n]+/g, '');
    pushText(text);
    index = end;
  }
  if (runs.length) endParagraph();

  return renderParagraphs(paragraphs, styles);
}

function renderRun(run: Run): string {
  if (run.hidden) return '';
  let html = escapeHtml(run.text).replace(/\n/g, '<br>').replace(/\t/g, ' ');
  if (run.sup) html = `<sup>${html}</sup>`;
  if (run.sub) html = `<sub>${html}</sub>`;
  if (run.strike) html = `<s>${html}</s>`;
  if (run.underline) html = `<u>${html}</u>`;
  if (run.italic) html = `<em>${html}</em>`;
  if (run.bold) html = `<strong>${html}</strong>`;
  if (run.link && /^(?:https?:|mailto:)/i.test(run.link)) {
    html = `<a href="${escapeAttribute(run.link)}">${html}</a>`;
  }
  return html;
}

function renderParagraphs(paragraphs: Paragraph[], styles: Map<number, string>): string {
  const output: string[] = [];
  let openList: 'bullet' | 'number' | null = null;
  const closeList = () => {
    if (openList) output.push(openList === 'bullet' ? '</ul>' : '</ol>');
    openList = null;
  };
  for (const paragraph of paragraphs) {
    const visibleRuns = paragraph.runs.filter((run) => !run.hidden && run.text.trim().length > 0);
    const text = paragraph.runs
      .map((run) => run.text)
      .join('')
      .trim();
    if (!text) {
      closeList();
      continue;
    }
    const styleName = styles.get(paragraph.style);
    const heading = headingLevelFor(styleName);
    let list = paragraph.list;
    if (styleName && /^list\s+number\b/.test(styleName)) list = 'number';
    else if (!list && styleName) {
      if (/^list\s+bullet\b/.test(styleName)) list = 'bullet';
      else if (styleName === 'list paragraph') list = 'bullet';
    }
    // A leading bullet glyph produced by \pntext/\bullet also marks a list item.
    if (!list && /^[•·]\s/.test(text)) list = 'bullet';
    if (list) {
      if (openList !== list) {
        closeList();
        output.push(list === 'bullet' ? '<ul>' : '<ol>');
        openList = list;
      }
      const itemRuns = paragraph.runs.map((run) => ({ ...run, text: run.text.replace(/^\s*[•·]\s*/, '') }));
      output.push(`<li>${itemRuns.map(renderRun).join('')}</li>`);
      continue;
    }
    closeList();
    if (visibleRuns.length === 0) continue;
    const inner = paragraph.runs.map(renderRun).join('');
    if (heading) output.push(`<h${heading}>${inner}</h${heading}>`);
    else output.push(`<p>${inner}</p>`);
  }
  closeList();
  return output.join('\n');
}
