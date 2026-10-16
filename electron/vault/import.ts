import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import path from 'node:path';
import { assetTypes, createAssetRegistry } from '../../src/shared/assets';
import { isInternallySupportedPath } from '../../src/shared/file-provenance';
import { IMAGE_TYPES } from './attachments';
import { sanitizeHtmlFragment, standaloneHtml } from './html-sanitize';
import { parseDocxStructure } from './docx-parser';
import { isEncryptedRecord, isPasswordEncryptedNote } from './security';

/** Never follow a selected symlink, including one in an ancestor directory. */
async function assertNoSymlinks(absolute: string) {
  let ancestor = absolute;
  while (true) {
    if ((await lstat(ancestor)).isSymbolicLink()) throw new Error('Symbolic links cannot be imported.');
    const parent = path.dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }
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
    if (length > stat.size || length > limit) throw new Error('The file changed or exceeds the import size limit.');
    await assertNoSymlinks(absolute);
    const current = await lstat(absolute);
    const opened = await file.stat();
    if (
      !current.isFile() ||
      current.dev !== stat.dev ||
      current.ino !== stat.ino ||
      opened.size !== stat.size ||
      opened.mtimeMs !== stat.mtimeMs
    )
      throw new Error('The source file changed during import. Retry importing it.');
    const content = bytes.subarray(0, length);
    if (text) {
      let value = new TextDecoder('utf-8', { fatal: true }).decode(content);
      let envelope: unknown;
      try {
        envelope = JSON.parse(value);
      } catch {
        envelope = null;
      }
      if (isEncryptedRecord(envelope) || isPasswordEncryptedNote(envelope))
        throw new Error('Encrypted content cannot be imported as an internal document.');
      asset?.parse(value);
      if (extension === '.html' || extension === '.htm')
        value = standaloneHtml(path.basename(source), sanitizeHtmlFragment(value));
      assertCurrent();
      return { bytes: Buffer.from(value, 'utf8'), extension: extension === '.htm' ? '.html' : extension };
    }
    if (extension === '.docx') parseDocxStructure(content);
    if (extension === '.pdf' && !content.subarray(0, 1024).includes(Buffer.from('%PDF-')))
      throw new Error('This is not a PDF document.');
    assertCurrent();
    return { bytes: content, extension };
  } finally {
    await file.close();
  }
}
