/**
 * Alius targets: the original files an Alius record points at. A target
 * lives outside the library and is never copied, never encrypted by the
 * app, and never written through the library's confined paths — so every
 * read and write here works on the absolute path directly, with its own
 * symlink and regular-file checks, instead of going through resolveEntry.
 */
import { constants } from 'node:fs';
import { lstat, open, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { createAssetRegistry, assetTypes } from '../../src/shared/assets';
import {
  assertNoSymlinks,
  guidanceForExtension,
  isSupportedDocument,
  readImportSource,
} from './import';
import { isEncryptedNoteSource } from './import';

/**
 * Extensions an Alius target must never have: executables, scripts,
 * installers, and shortcuts. Anything else can be a target (Q3), even
 * when the app cannot preview it — it still opens externally.
 */
export const ALIUS_FORBIDDEN_EXTENSIONS = new Set([
  // Windows executables and installers
  '.exe',
  '.com',
  '.scr',
  '.msi',
  '.msp',
  '.msm',
  '.cpl',
  '.msc',
  '.gadget',
  // Scripts
  '.bat',
  '.cmd',
  '.ps1',
  '.psm1',
  '.psd1',
  '.vbs',
  '.vbe',
  '.js',
  '.jse',
  '.wsf',
  '.wsh',
  '.hta',
  '.reg',
  '.inf',
  '.sh',
  '.bash',
  '.zsh',
  '.py',
  '.pyw',
  '.rb',
  '.pl',
  '.php',
  '.cgi',
  // Shortcuts and launchers
  '.lnk',
  '.url',
  '.scf',
  '.app',
  '.action',
  '.command',
  '.workflow',
  '.desktop',
  // Other executable containers
  '.jar',
  '.apk',
  '.dmg',
  '.pkg',
  '.run',
  '.bin',
  '.dll',
  '.sys',
  '.ocx',
]);

/** Largest target the app reads in full: the same 40 MiB limit as library files. */
export const ALIUS_TARGET_BYTE_LIMIT = 40 * 1024 * 1024;

/**
 * Validate a file as an Alius target at import time (and again when a
 * broken Alius is retargeted): it must exist as a regular file with no
 * symlinks anywhere in its path, must not be an executable, script, or
 * shortcut, must not be a link-pointer or unreadable format, and must not
 * be a cognitive tool or an encrypted note. Supported documents get the
 * full import validation (format, size, PDF protection) by reading them.
 */
export async function validateAliusTarget(source: string): Promise<void> {
  const resolved = path.resolve(source);
  let stat: Awaited<ReturnType<typeof lstat>>;
  try {
    stat = await lstat(resolved);
  } catch {
    throw new Error('The original file could not be found.');
  }
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new Error('An Alius must point to a regular file, not a folder or a shortcut.');
  await assertNoSymlinks(resolved);
  const extension = path.extname(resolved).toLowerCase();
  if (ALIUS_FORBIDDEN_EXTENSIONS.has(extension))
    throw new Error('Executables, scripts, and shortcuts cannot be Alius targets.');
  const guidance = guidanceForExtension(extension);
  if (guidance) throw new Error(guidance);
  // Cognitive tools live in the library, not outside it — except CSV,
  // which the Grid tool also claims but opens as a spreadsheet.
  if (extension !== '.csv' && createAssetRegistry(assetTypes).resolve(resolved))
    throw new Error('Cognitive tools cannot be Alius targets. Copy the file into the library instead.');
  if (isSupportedDocument(resolved)) {
    // Full import validation: format, size, PDF protection, encrypted
    // notes, and text encoding. The bytes are discarded; the original
    // is never copied.
    await readImportSource(resolved);
    return;
  }
  // Any other file is allowed as a target (Q3): confirm only that it can
  // be opened for reading. An encrypted note source is refused even
  // here, so a note that only opens with a password never becomes a
  // shortcut that shows ciphertext.
  const handle = await open(resolved, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat();
    if (!opened.isFile()) throw new Error('An Alius must point to a regular file, not a folder or a shortcut.');
    if (['.md', '.html', '.htm', '.txt'].includes(extension)) {
      const head = Buffer.alloc(Math.min(opened.size, 64 * 1024));
      const { bytesRead } = await handle.read(head, 0, head.length, 0);
      if (isEncryptedNoteSource(head.subarray(0, bytesRead).toString('utf8')))
        throw new Error(
          'Encrypted notes cannot be Alius targets. Unlock the original library or note and explicitly export an authorized plaintext copy first.',
        );
    }
  } finally {
    await handle.close();
  }
}

/**
 * Read an Alius target's bytes with the same 40 MiB limit as library
 * files. No library decryption is applied: the target is never encrypted
 * by the app.
 */
export async function readAliusTargetBytes(target: string, label: string): Promise<Buffer> {
  const stat = await lstat(target);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > ALIUS_TARGET_BYTE_LIMIT)
    throw new Error(`This ${label} exceeds the 40 MiB file limit.`);
  const file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await file.stat();
    if (!opened.isFile() || opened.size > ALIUS_TARGET_BYTE_LIMIT)
      throw new Error(`This ${label} exceeds the 40 MiB file limit.`);
    const bytes = await file.readFile();
    if (bytes.length > ALIUS_TARGET_BYTE_LIMIT) throw new Error(`This ${label} exceeds the 40 MiB file limit.`);
    return bytes;
  } finally {
    await file.close();
  }
}

/**
 * Write bytes back to an Alius target atomically: stage a temp file in
 * the target's own directory and rename it over the target, preserving
 * the target's permissions. The temp file is never resolved through the
 * library, because the target lives outside it.
 */
export async function writeAliusTargetBytes(target: string, bytes: Buffer): Promise<void> {
  const stat = await lstat(target);
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new Error('The original file is no longer a regular file.');
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, bytes, { flag: 'wx', mode: stat.mode & 0o777 });
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}
