/**
 * Pasted clipboard content: the shared shape and pure helpers for the
 * guided paste flow (Feature 2). The renderer reads the clipboard and
 * asks the three guided questions — note or attachment, format, name —
 * then the main process writes the content through this input.
 */

/** How pasted content is stored: an editable note, or a file kept in the notebook. */
export type PasteContentKind = 'note' | 'attachment';

/** The stored format for pasted text: Markdown, HTML (rich text), or plain text. */
export type PasteContentFormat = 'markdown' | 'html' | 'txt';

/** The file extension for a stored paste format. */
export function pasteContentExtension(format: PasteContentFormat): '.md' | '.html' | '.txt' {
  return format === 'html' ? '.html' : format === 'txt' ? '.txt' : '.md';
}

/**
 * What the renderer sends to the main process to store pasted content.
 * Text pastes carry `text`; image pastes carry `image` bytes with their
 * MIME type. `altText` is the picture description, kept when the source
 * or the user provides one.
 */
export interface PasteContentInput {
  /** Notebook the pasted content goes into ('' for the library root is not allowed: a notebook is always picked). */
  notebookPath: string;
  /** Full file name with extension, for example "Shopping list.md" or "Pasted image.png". */
  fileName: string;
  kind: PasteContentKind;
  text?: string;
  image?: ArrayBuffer;
  imageMimeType?: string;
  altText?: string;
}

/**
 * Size guard for pasted content, mirroring the import limits: text and
 * HTML notes cap at 5 MB, images at 20 MB. A larger paste is refused
 * with a clear reason instead of freezing the editor.
 */
export const PASTE_TEXT_LIMIT_BYTES = 5 * 1024 * 1024;
export const PASTE_IMAGE_LIMIT_BYTES = 20 * 1024 * 1024;

/** The file extension for a clipboard image MIME type, or null when it is not an image. */
export function pasteImageExtension(mimeType: string): string | null {
  switch (mimeType.toLowerCase()) {
    case 'image/png':
      return '.png';
    case 'image/jpeg':
      return '.jpg';
    case 'image/gif':
      return '.gif';
    case 'image/webp':
      return '.webp';
    case 'image/bmp':
      return '.bmp';
    default:
      return null;
  }
}

const ILLEGAL_FILE_NAME_CHARACTERS = /[<>:"/\\|?*\p{Cc}]/gu;

/** Turn a user-typed name into a safe file-name stem: illegal characters become '-', ends are trimmed. */
export function sanitizePasteFileStem(name: string): string {
  const stem = name
    .replace(ILLEGAL_FILE_NAME_CHARACTERS, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, 100);
  return stem;
}

/**
 * Default file name for pasted text: the first line, with Markdown
 * heading and list markers stripped so "# Shopping list" becomes
 * "Shopping list". Falls back to "Pasted text" when the first line is
 * empty or holds nothing usable.
 */
export function firstLinePasteName(text: string): string {
  const firstLine = text
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) return 'Pasted text';
  const withoutMarker = firstLine
    .replace(/^#{1,6}\s+/, '')
    .replace(/^[-*+]\s+/, '')
    .replace(/^\d+[.)]\s+/, '')
    .trim();
  return sanitizePasteFileStem(withoutMarker) || 'Pasted text';
}

/** Default file name for a pasted picture: the clipboard file name when it has one, else "Pasted image". */
export function defaultPasteImageName(clipboardName?: string): string {
  const stem = (clipboardName ?? '').replace(/\.(?:png|jpe?g|gif|webp|bmp)$/i, '').trim();
  // The clipboard synthesizes the generic name "image.png" for a pasted
  // picture; that is not a real source name, so it falls back too.
  if (!stem || stem.toLowerCase() === 'image') return 'Pasted image';
  return sanitizePasteFileStem(stem) || 'Pasted image';
}

/** Longest picture description kept from a clipboard source; the paste dialog field caps at 2000. */
export const PASTE_IMAGE_DESCRIPTION_LIMIT = 2000;

/**
 * Decode the entities a browser writes into copied HTML attribute values
 * and captions, so "A &amp; B" is kept as "A & B". Only the entities a
 * clipboard fragment realistically carries; anything else stays literal.
 */
function decodeClipboardEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_match, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * The picture description a copied image carries: the copied <img>
 * element's alt text first, then the caption of its <figure> when the
 * image itself has none (Q13: captions and alt text are both kept).
 * Returns undefined when the source provides neither — a screenshot or
 * a copied file has no description anywhere on the clipboard, so the
 * user supplies one in the paste dialog instead. Plain string parsing,
 * no DOM: this module is shared with the main process, which has none.
 */
export function extractPastedImageDescription(html: string): string | undefined {
  if (!html.trim()) return undefined;
  const imageTag = /<img\b[^>]*>/i.exec(html)?.[0];
  if (imageTag) {
    const alt = /\salt\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(imageTag);
    const value = decodeClipboardEntities(alt?.[1] ?? alt?.[2] ?? alt?.[3] ?? '').trim();
    if (value) return value.slice(0, PASTE_IMAGE_DESCRIPTION_LIMIT);
  }
  const figure = /<figure\b[^>]*>([\s\S]*?)<\/figure>/i.exec(html)?.[1] ?? html;
  const caption = /<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/i.exec(figure)?.[1];
  if (caption) {
    const value = decodeClipboardEntities(caption.replace(/<[^>]*>/g, '')).trim();
    if (value) return value.slice(0, PASTE_IMAGE_DESCRIPTION_LIMIT);
  }
  return undefined;
}

/**
 * A library-relative path expressed from another library-relative
 * directory, for an image stored beside its note: from "Seeded" to
 * "Seeded/Pasted image.png" is "Pasted image.png"; across notebooks it
 * climbs with ".." segments.
 */
export function relativeLibraryPath(fromDirectory: string, toPath: string): string {
  const from = fromDirectory.split('/').filter(Boolean);
  const to = toPath.split('/').filter(Boolean);
  let common = 0;
  while (common < from.length && common < to.length && from[common] === to[common]) common += 1;
  const ups = Array.from({ length: from.length - common }, () => '..');
  return [...ups, ...to.slice(common)].join('/');
}

/** Wrap plain text as simple HTML paragraphs, for a pasted-text rich-text (HTML) note. */
export function plainTextToHtml(text: string): string {
  const escape = (value: string) =>
    value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escape(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}
