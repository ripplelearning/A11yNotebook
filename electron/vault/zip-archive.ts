import { inflateRawSync } from 'node:zlib';

// Hardened ZIP reader shared by the Office/OpenDocument package parsers
// (DOCX, XLSX, PPTX, ODS, ODP). Extracted from the DOCX parser so the
// archive validation lives in exactly one place. `label` names the
// format in error messages, e.g. 'DOCX' or 'XLSX'.
const MAX_ARCHIVE_BYTES = 40 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 50 * 1024 * 1024;
const MAX_ENTRIES = 10_000;
const MAX_ENTRY_BYTES = 20 * 1024 * 1024;

export interface ZipEntry {
  path: string;
  bytes: Buffer;
  mediaType?: string;
}

function invalid(message: string): never {
  throw new Error(message);
}

function crc32(buffer: Buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function decodeEntryName(bytes: Buffer, utf8: boolean, label: string) {
  if (utf8) {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      return invalid(`The ${label} archive contains an invalid UTF-8 entry name.`);
    }
  }
  return bytes.toString('latin1');
}

export function readZipEntries(bytes: Buffer, label: string): Map<string, ZipEntry> {
  if (!bytes.length || bytes.length > MAX_ARCHIVE_BYTES)
    invalid(`This ${label} is invalid or exceeds the 40 MiB archive limit.`);
  const minEnd = Math.max(0, bytes.length - 65_557);
  let end = -1;
  for (let index = bytes.length - 22; index >= minEnd; index -= 1) {
    if (bytes.readUInt32LE(index) === 0x06054b50 && index + 22 + bytes.readUInt16LE(index + 20) === bytes.length) {
      end = index;
      break;
    }
  }
  if (end < 0) invalid(`The ${label} ZIP archive is malformed or truncated.`);
  if (bytes.readUInt16LE(end + 4) !== 0 || bytes.readUInt16LE(end + 6) !== 0) {
    invalid(`Multi-disk ${label} archives are not supported.`);
  }
  const diskEntries = bytes.readUInt16LE(end + 8);
  const count = bytes.readUInt16LE(end + 10);
  const directorySize = bytes.readUInt32LE(end + 12);
  const directoryOffset = bytes.readUInt32LE(end + 16);
  if (diskEntries !== count || count > MAX_ENTRIES || count === 0xffff || directoryOffset === 0xffffffff) {
    invalid(`The ${label} ZIP entry count or format is unsupported.`);
  }
  const directoryEnd = directoryOffset + directorySize;
  if (directoryEnd !== end || directoryEnd > bytes.length) invalid(`The ${label} ZIP directory is malformed.`);

  const metadata: Array<{
    path: string;
    name: string;
    isDirectory: boolean;
    flags: number;
    method: number;
    crc: number;
    compressedSize: number;
    expandedSize: number;
    localOffset: number;
  }> = [];
  const dataRanges: Array<[number, number]> = [];
  const names = new Set<string>();
  let cursor = directoryOffset;
  let expandedTotal = 0;
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > directoryEnd || bytes.readUInt32LE(cursor) !== 0x02014b50) {
      invalid(`The ${label} central directory is malformed.`);
    }
    const madeBy = bytes.readUInt16LE(cursor + 4);
    const flags = bytes.readUInt16LE(cursor + 8);
    const method = bytes.readUInt16LE(cursor + 10);
    const crc = bytes.readUInt32LE(cursor + 16);
    const compressedSize = bytes.readUInt32LE(cursor + 20);
    const expandedSize = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const disk = bytes.readUInt16LE(cursor + 34);
    const externalAttributes = bytes.readUInt32LE(cursor + 38);
    const localOffset = bytes.readUInt32LE(cursor + 42);
    const nameStart = cursor + 46;
    const recordEnd = nameStart + nameLength + extraLength + commentLength;
    if (recordEnd > directoryEnd || !nameLength || disk !== 0)
      invalid(`The ${label} ZIP entry record is invalid.`);
    const name = decodeEntryName(
      bytes.subarray(nameStart, nameStart + nameLength),
      Boolean(flags & 0x800),
      label,
    );
    const isDirectory = name.endsWith('/');
    const normalized = isDirectory ? name.slice(0, -1) : name;
    const segments = normalized.split('/');
    const unixMode = (externalAttributes >>> 16) & 0xf000;
    if (
      !normalized ||
      name.includes('\\') ||
      name.includes('\0') ||
      name.startsWith('/') ||
      /^[a-z]:/i.test(name) ||
      segments.some((segment) => !segment || segment === '.' || segment === '..') ||
      segments.length > 32
    ) {
      invalid(`The ${label} ZIP contains a traversal, absolute, or over-deep entry path.`);
    }
    if (madeBy >> 8 === 3 && unixMode === 0xa000)
      invalid(`Symbolic links are not supported in ${label} archives.`);
    if (flags & 1) invalid(`Encrypted ${label} ZIP entries are not supported.`);
    if (flags & 0x40) invalid(`Strongly encrypted ${label} ZIP entries are not supported.`);
    if (flags & ~(0x800 | 0x8 | 0x6)) invalid(`The ${label} archive uses unsupported ZIP flags.`);
    if (![0, 8].includes(method)) invalid(`The ${label} archive uses an unsupported compression method.`);
    if (compressedSize === 0xffffffff || expandedSize === 0xffffffff || localOffset === 0xffffffff) {
      invalid(`ZIP64 ${label} archives are not supported.`);
    }
    if (expandedSize > MAX_ENTRY_BYTES || compressedSize > MAX_ARCHIVE_BYTES) {
      invalid(`A ${label} archive entry exceeds the per-entry size limit.`);
    }
    expandedTotal += expandedSize;
    if (expandedTotal > MAX_EXPANDED_BYTES) invalid(`The ${label} archive expands beyond the 50 MiB limit.`);
    if (names.has(normalized.toLowerCase())) invalid(`The ${label} archive contains duplicate entry names.`);
    names.add(normalized.toLowerCase());
    if (isDirectory && (compressedSize !== 0 || expandedSize !== 0)) {
      invalid(`${label} ZIP directory entries must not contain file data.`);
    }
    metadata.push({
      path: normalized,
      name,
      isDirectory,
      flags,
      method,
      crc,
      compressedSize,
      expandedSize,
      localOffset,
    });
    cursor = recordEnd;
  }
  if (cursor !== directoryEnd) invalid(`The ${label} ZIP directory length is inconsistent.`);

  const entries = new Map<string, ZipEntry>();
  for (const item of metadata) {
    const offset = item.localOffset;
    if (offset + 30 > directoryOffset || bytes.readUInt32LE(offset) !== 0x04034b50) {
      invalid(`A ${label} ZIP entry has an invalid local header.`);
    }
    const flags = bytes.readUInt16LE(offset + 6);
    const method = bytes.readUInt16LE(offset + 8);
    const localNameLength = bytes.readUInt16LE(offset + 26);
    const localExtraLength = bytes.readUInt16LE(offset + 28);
    const dataStart = offset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + item.compressedSize;
    const localName = decodeEntryName(
      bytes.subarray(offset + 30, offset + 30 + localNameLength),
      Boolean(flags & 0x800),
      label,
    );
    if (
      flags !== item.flags ||
      method !== item.method ||
      localName !== item.name ||
      dataStart < offset + 30 + localNameLength ||
      dataStart > directoryOffset ||
      dataEnd > directoryOffset
    ) {
      invalid(`A ${label} ZIP entry has inconsistent local and central headers.`);
    }
    if (!(flags & 0x8)) {
      if (
        bytes.readUInt32LE(offset + 14) !== item.crc ||
        bytes.readUInt32LE(offset + 18) !== item.compressedSize ||
        bytes.readUInt32LE(offset + 22) !== item.expandedSize
      ) {
        invalid(`A ${label} ZIP entry has inconsistent local size or checksum metadata.`);
      }
    }
    dataRanges.push([offset, dataEnd]);
    const compressed = bytes.subarray(dataStart, dataEnd);
    let content: Buffer;
    try {
      content =
        item.method === 0
          ? Buffer.from(compressed)
          : inflateRawSync(compressed, { maxOutputLength: Math.min(MAX_ENTRY_BYTES, MAX_EXPANDED_BYTES) });
    } catch {
      invalid(`A ${label} ZIP entry is malformed or exceeds the decompression limit.`);
    }
    if (content.length !== item.expandedSize || crc32(content) !== item.crc) {
      invalid(`A ${label} ZIP entry failed its size or checksum validation.`);
    }
    if (!item.isDirectory) entries.set(item.path, { path: item.path, bytes: content });
  }
  dataRanges.sort((left, right) => left[0] - right[0]);
  for (let index = 1; index < dataRanges.length; index += 1) {
    if (dataRanges[index][0] < dataRanges[index - 1][1]) invalid(`${label} ZIP entries overlap.`);
  }
  return entries;
}
