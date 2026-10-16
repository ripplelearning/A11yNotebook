import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import path from 'node:path';
import { IMAGE_TYPES } from './attachments';
import { parseDocxStructure } from './docx-parser';
import { extractEpubPages, extractPdfPages } from './document-preview';
import { createAssetRegistry, assetTypes } from '../../src/shared/assets';
import { isEncryptedRecord, isPasswordEncryptedNote } from './security';
import { isInternallySupportedPath } from '../../src/shared/file-provenance';
import { sanitizeHtmlFragment, standaloneHtml } from './html-sanitize';

export function isEncryptedNoteSource(text: string) {
  let envelope: unknown;
  try {
    envelope = JSON.parse(text);
  } catch {
    envelope = null;
  }
  return (
    isEncryptedRecord(envelope) ||
    isPasswordEncryptedNote(envelope) ||
    /^\s*\{[\s\S]*?"format"\s*:\s*"a11ynotebook-(?:encrypted|password-note)-/i.test(text)
  );
}

export function importedCopyPath(relative: string, attempt: number) {
  if (!attempt) return relative;
  const name = path.posix.basename(relative);
  const suffix =
    assetTypes
      .flatMap((type) => type.extensions)
      .sort((a, b) => b.length - a.length)
      .find((extension) => name.toLowerCase().endsWith(extension)) ?? path.posix.extname(name);
  const characters = [...name.slice(0, name.length - suffix.length)];
  while (Buffer.byteLength(characters.join(''), 'utf8') > 180) characters.pop();
  const stem = characters.join('');
  return path.posix.join(
    path.posix.dirname(relative),
    `${stem} (imported${attempt > 1 ? ` ${attempt}` : ''})${name.slice(name.length - suffix.length)}`,
  );
}

async function validatePdfImport(bytes: Buffer) {
  // Reuse the same PDF.js permission/password boundary as PDF annotations.
  extractPdfPages(bytes);
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loading = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, enableXfa: false, verbosity: 0 });
  try {
    const document = await loading.promise;
    if ((await document.getPermissions()) !== null)
      throw new Error('Protected PDFs cannot be imported as managed documents.');
  } catch (error) {
    if (error instanceof Error && error.name === 'PasswordException')
      throw new Error('Password-protected PDFs cannot be imported. Export an authorized unprotected copy first.');
    throw error;
  } finally {
    await loading.destroy();
  }
}

export const IMPORT_EXTENSIONS = [
  'md',
  'html',
  'htm',
  'txt',
  'csv',
  'pdf',
  'epub',
  'docx',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
  'json',
];

export function isSupportedDocument(filename: string) {
  const extension = path.extname(filename).toLowerCase();
  return (
    IMPORT_EXTENSIONS.includes(extension.slice(1)) &&
    (extension !== '.json' || filename.toLowerCase().endsWith('.mindmap.json'))
  );
}

/** The caller supplies a path chosen by a native main-process dialog, never IPC data. */
async function assertNoSymlinks(absolute: string) {
  let ancestor = absolute;
  while (true) {
    if ((await lstat(ancestor)).isSymbolicLink())
      throw new Error('Import requires a regular file. Symbolic links cannot be imported.');
    const parent = path.dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }
}

export async function readImportSource(source: string, assertCurrent: () => void = () => undefined) {
  source = path.resolve(source);
  assertCurrent();
  await assertNoSymlinks(source);
  if (path.extname(source).toLowerCase() === '.json' && !source.toLowerCase().endsWith('.mindmap.json'))
    throw new Error('Only .mindmap.json JSON assets are supported. Other JSON files cannot be imported as notes.');
  if (!isSupportedDocument(source))
    throw new Error(
      'Choose a supported note, document, image, or cognitive asset. There is no internal importer for this format; use Open With for supported external documents.',
    );
  const extension = path.extname(source).toLowerCase();
  const limit = ['.pdf', '.epub', '.docx'].includes(extension)
    ? 40 * 1024 * 1024
    : IMAGE_TYPES[extension]
      ? 20 * 1024 * 1024
      : 5 * 1024 * 1024;
  const before = await lstat(source);
  if (!before.isFile() || before.isSymbolicLink() || before.size > limit)
    throw new Error('Import requires a regular file within the supported size limit.');
  const handle = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW);
  let bytes: Buffer;
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.dev !== before.dev || stat.ino !== before.ino || stat.size > limit)
      throw new Error('The selected file changed. Select it again.');
    const buffer = Buffer.alloc(stat.size + 1);
    let length = 0;
    while (length < buffer.length) {
      assertCurrent();
      const result = await handle.read(buffer, length, buffer.length - length, length);
      if (!result.bytesRead) break;
      length += result.bytesRead;
    }
    const after = await handle.stat();
    await assertNoSymlinks(source);
    const current = await lstat(source);
    if (
      length !== stat.size ||
      after.size !== stat.size ||
      after.mtimeMs !== stat.mtimeMs ||
      current.dev !== stat.dev ||
      current.ino !== stat.ino ||
      current.birthtimeMs !== stat.birthtimeMs ||
      current.mtimeMs !== stat.mtimeMs ||
      current.size !== stat.size
    )
      throw new Error('The selected file changed during import. Select it again.');
    bytes = buffer.subarray(0, length);
  } finally {
    await handle.close();
  }
  if (extension === '.docx') parseDocxStructure(bytes, { forImport: true });
  else if (extension === '.pdf') await validatePdfImport(bytes);
  else if (extension === '.epub') extractEpubPages(bytes, { forImport: true });
  else if (IMAGE_TYPES[extension]) {
    const valid =
      extension === '.png'
        ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : ['.jpg', '.jpeg'].includes(extension)
          ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
          : extension === '.gif'
            ? /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString('ascii'))
            : extension === '.webp'
              ? bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP'
              : bytes.subarray(0, 2).toString() === 'BM';
    if (!valid) throw new Error('The selected image does not match its file format.');
  } else {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (text.includes('\0')) throw new Error('Import requires UTF-8 text without binary data.');
    if (isEncryptedNoteSource(text))
      throw new Error(
        'Encrypted notes cannot be imported as editable notes. Unlock the original library or note and explicitly export an authorized plaintext copy first.',
      );
    const asset = createAssetRegistry(assetTypes).resolve(source);
    if (asset) {
      if (bytes.length > 2 * 1024 * 1024) throw new Error('Assets must be files smaller than 2 MB.');
      asset.parse(text);
    }
  }
  assertCurrent();
  return bytes;
}

export async function readImport(source: string, assertCurrent: () => void, allowUnsupported = false) {
  const absolute = path.resolve(source);
  await assertNoSymlinks(absolute);
  const extension = path.extname(source).toLowerCase();
  const asset = createAssetRegistry(assetTypes).resolve(source);
  const note = ['.md', '.html', '.htm'].includes(extension);
  const text = note || asset || extension === '.txt';
  if (!isInternallySupportedPath(source) && !allowUnsupported)
    throw new Error('This file type is not supported for internal import.');
  const limitMiB = asset ? 2 : extension === '.txt' ? 5 : note ? 8 : IMAGE_TYPES[extension] ? 20 : 40;
  const limit = limitMiB * 1024 * 1024;
  const file = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > limit) throw new Error('The file is too large or is not a regular file.');
    const bytes = Buffer.alloc(Math.min(stat.size + 1, limit + 1));
    let length = 0;
    while (length < bytes.length) {
      assertCurrent();
      const result = await file.read(bytes, length, bytes.length - length, length);
      if (!result.bytesRead) break;
      length += result.bytesRead;
    }
    if (length !== stat.size || length > limit) throw new Error('The file changed or exceeds the import size limit.');
    await assertNoSymlinks(absolute);
    const current = await lstat(absolute);
    const opened = await file.stat();
    if (
      !current.isFile() ||
      current.dev !== stat.dev ||
      current.ino !== stat.ino ||
      current.birthtimeMs !== stat.birthtimeMs ||
      opened.size !== stat.size ||
      opened.mtimeMs !== stat.mtimeMs
    )
      throw new Error('The source file changed during import. Retry importing it.');
    const content = bytes.subarray(0, length);
    if (text) {
      let value = new TextDecoder('utf-8', { fatal: true }).decode(content);
      if (isEncryptedNoteSource(value))
        throw new Error('Encrypted content cannot be imported as an internal document.');
      asset?.parse(value);
      if (extension === '.html' || extension === '.htm')
        value = standaloneHtml(path.basename(source), sanitizeHtmlFragment(value));
      assertCurrent();
      return { bytes: Buffer.from(value, 'utf8'), extension: extension === '.htm' ? '.html' : extension };
    }
    if (extension === '.docx') parseDocxStructure(content, { forImport: true });
    if (extension === '.pdf') await validatePdfImport(content);
    if (extension === '.epub') extractEpubPages(content, { forImport: true });
    assertCurrent();
    return { bytes: content, extension };
  } finally {
    await file.close();
  }
}
