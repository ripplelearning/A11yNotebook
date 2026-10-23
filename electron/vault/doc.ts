/**
 * Local text extraction for legacy Word 97-2003 binary documents (.doc).
 *
 * A .doc file is an OLE Compound File Binary (CFB) container holding a
 * WordDocument stream and a table stream. The document text is described by
 * the piece table (CLX) inside the table stream (see [MS-DOC] and [MS-CFB]).
 * This extractor follows those specifications locally: it recovers the text
 * and paragraph breaks, including fast-saved documents whose text is split
 * across pieces. Formatting, images, and embedded objects are not extracted;
 * an imported .doc becomes an editable plain-text note. Anything that does
 * not parse as a standard Word binary document is rejected with a clear
 * error rather than guessed at.
 */

const CFB_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const END_OF_CHAIN = 0xfffffffe;
const FREE_SECTOR = 0xffffffff;
const MAX_SECTORS = 1 << 20;

export function isDocSource(bytes: Buffer): boolean {
  return bytes.length >= 8 && CFB_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

interface Cfb {
  sectorSize: number;
  miniSectorSize: number;
  miniCutoff: number;
  fat: Uint32Array;
  miniFat: Uint32Array;
  directory: Array<{ name: string; type: number; startSector: number; size: number }>;
  miniStream: Buffer;
  bytes: Buffer;
}

function sectorOffset(cfb: Pick<Cfb, 'sectorSize'>, sector: number): number {
  return (sector + 1) * cfb.sectorSize;
}

function followChain(fat: Uint32Array, start: number, limit: number): number[] {
  const chain: number[] = [];
  const seen = new Set<number>();
  let sector = start;
  while (sector !== END_OF_CHAIN && sector !== FREE_SECTOR && sector < fat.length) {
    if (seen.has(sector) || chain.length >= limit) throw new Error('The .doc file has a corrupt sector chain.');
    seen.add(sector);
    chain.push(sector);
    sector = fat[sector];
  }
  return chain;
}

function readChain(bytes: Buffer, cfb: Cfb, start: number, size?: number): Buffer {
  const chain = followChain(cfb.fat, start, MAX_SECTORS);
  const parts = chain.map((sector) => {
    const offset = sectorOffset(cfb, sector);
    return bytes.subarray(offset, offset + cfb.sectorSize);
  });
  const joined = Buffer.concat(parts);
  return size === undefined ? joined : joined.subarray(0, size);
}

function parseCfb(bytes: Buffer): Cfb {
  if (!isDocSource(bytes)) throw new Error('The selected file is not a Word .doc document.');
  if (bytes.length < 512) throw new Error('The .doc file is truncated.');
  const sectorShift = bytes.readUInt16LE(30);
  const miniSectorShift = bytes.readUInt16LE(32);
  if (sectorShift < 7 || sectorShift > 12 || miniSectorShift > sectorShift) {
    throw new Error('The .doc file has an invalid sector layout.');
  }
  const sectorSize = 1 << sectorShift;
  const miniSectorSize = 1 << miniSectorShift;
  const miniCutoff = bytes.readUInt32LE(56);
  const firstDirectorySector = bytes.readUInt32LE(48);
  const firstMiniFatSector = bytes.readUInt32LE(60);
  const numberOfMiniFatSectors = bytes.readUInt32LE(64);
  const firstDifatSector = bytes.readUInt32LE(68);
  const numberOfDifatSectors = bytes.readUInt32LE(72);

  // Collect the DIFAT: 109 entries live in the header, the rest chain.
  const fatSectorIds: number[] = [];
  for (let index = 0; index < 109; index += 1) {
    const sector = bytes.readUInt32LE(76 + index * 4);
    if (sector !== FREE_SECTOR) fatSectorIds.push(sector);
  }
  let difatSector = firstDifatSector;
  const seenDifat = new Set<number>();
  for (let count = 0; count < numberOfDifatSectors; count += 1) {
    if (difatSector === END_OF_CHAIN || difatSector === FREE_SECTOR || seenDifat.has(difatSector)) break;
    seenDifat.add(difatSector);
    const offset = (difatSector + 1) * sectorSize;
    if (offset + sectorSize > bytes.length) throw new Error('The .doc file is truncated.');
    const entriesPerSector = sectorSize / 4 - 1;
    for (let index = 0; index < entriesPerSector; index += 1) {
      const sector = bytes.readUInt32LE(offset + index * 4);
      if (sector !== FREE_SECTOR) fatSectorIds.push(sector);
    }
    difatSector = bytes.readUInt32LE(offset + sectorSize - 4);
  }

  const fatParts = fatSectorIds.map((sector) => {
    const offset = (sector + 1) * sectorSize;
    if (offset + sectorSize > bytes.length) throw new Error('The .doc file is truncated.');
    return bytes.subarray(offset, offset + sectorSize);
  });
  const fatBytes = Buffer.concat(fatParts);
  const fat = new Uint32Array(fatBytes.buffer, fatBytes.byteOffset, Math.floor(fatBytes.length / 4));

  const partial: Cfb = {
    sectorSize,
    miniSectorSize,
    miniCutoff,
    fat,
    miniFat: new Uint32Array(0),
    directory: [],
    miniStream: Buffer.alloc(0),
    bytes,
  };

  // MiniFAT sectors form their own chain in the regular FAT.
  if (numberOfMiniFatSectors > 0 && firstMiniFatSector !== END_OF_CHAIN) {
    const miniFatBytes = readChain(bytes, partial, firstMiniFatSector).subarray(0, numberOfMiniFatSectors * sectorSize);
    partial.miniFat = new Uint32Array(
      miniFatBytes.buffer,
      miniFatBytes.byteOffset,
      Math.floor(miniFatBytes.length / 4),
    );
  }

  const directoryBytes = readChain(bytes, partial, firstDirectorySector);
  const directory: Cfb['directory'] = [];
  for (let offset = 0; offset + 128 <= directoryBytes.length; offset += 128) {
    const nameLength = directoryBytes.readUInt16LE(offset + 64);
    if (nameLength < 2 || nameLength > 64) continue;
    const name = directoryBytes.toString('utf16le', offset, offset + nameLength - 2);
    directory.push({
      name,
      type: directoryBytes[offset + 66],
      startSector: directoryBytes.readUInt32LE(offset + 116),
      size: Number(directoryBytes.readBigUInt64LE(offset + 120)),
    });
  }
  partial.directory = directory;

  const root = directory.find((entry) => entry.type === 5);
  if (root && root.size > 0) {
    partial.miniStream = readChain(bytes, partial, root.startSector, root.size);
  }
  return partial;
}

function readStream(cfb: Cfb, name: string): Buffer {
  const entry = cfb.directory.find((candidate) => candidate.name === name && candidate.type === 2);
  if (!entry) throw new Error(`The .doc file is missing its ${name} stream.`);
  if (entry.size < cfb.miniCutoff && cfb.miniFat.length > 0) {
    const parts: Buffer[] = [];
    const seen = new Set<number>();
    let sector = entry.startSector;
    while (sector !== END_OF_CHAIN && sector !== FREE_SECTOR && sector < cfb.miniFat.length) {
      if (seen.has(sector)) throw new Error('The .doc file has a corrupt mini sector chain.');
      seen.add(sector);
      const offset = sector * cfb.miniSectorSize;
      parts.push(cfb.miniStream.subarray(offset, offset + cfb.miniSectorSize));
      sector = cfb.miniFat[sector];
    }
    return Buffer.concat(parts).subarray(0, entry.size);
  }
  return readChain(cfb.bytes, cfb, entry.startSector, entry.size);
}

const cp1252 = new TextDecoder('windows-1252');

function decodePiece(bytes: Buffer, offset: number, byteLength: number, compressed: boolean): string {
  const slice = bytes.subarray(offset, Math.min(offset + byteLength, bytes.length));
  return compressed ? cp1252.decode(slice) : slice.toString('utf16le');
}

/* eslint-disable no-control-regex -- Word text legitimately contains C0 field/structure markers that must be normalized. */
function normalizeDocText(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000e-\u0012\u001a\u001c-\u001f]/g, '')
    .replace(/[\u0013\u0014\u0015]/g, '') // field begin/separate/end markers
    .replace(/\u001e/g, '-')
    .replace(/\u001f/g, '')
    .replace(/\u000b/g, '\n') // manual line break
    .replace(/\u000c/g, '\n') // page break starts a new paragraph block
    .replace(/\u0007/g, '\t') // table cell/row marks
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
/* eslint-enable no-control-regex */

/** Extract plain text (paragraphs separated by newlines) from .doc bytes. */
export function extractDocText(bytes: Buffer): string {
  const cfb = parseCfb(bytes);
  const wordDocument = readStream(cfb, 'WordDocument');
  if (wordDocument.length < 0x01ba) throw new Error('The .doc document stream is truncated.');
  if (wordDocument.readUInt16LE(0) !== 0xa5ec) throw new Error('The selected file is not a Word 97-2003 document.');
  const flags = wordDocument.readUInt16LE(0x000a);
  const tableStream = readStream(cfb, flags & 0x0200 ? '1Table' : '0Table');

  const fcClx = wordDocument.readInt32LE(0x01a2);
  const lcbClx = wordDocument.readUInt32LE(0x01a6);
  let pieces: Array<{ start: number; end: number; fileOffset: number; compressed: boolean }> = [];
  if (lcbClx > 0 && fcClx >= 0 && fcClx + lcbClx <= tableStream.length) {
    let offset = fcClx;
    const clxEnd = fcClx + lcbClx;
    while (offset < clxEnd) {
      const kind = tableStream[offset];
      if (kind === 0x01) {
        const size = tableStream.readUInt32LE(offset + 1);
        offset += 5 + size;
        continue;
      }
      if (kind !== 0x02) break;
      const size = tableStream.readUInt32LE(offset + 1);
      const plcStart = offset + 5;
      const count = Math.floor((size - 4) / 12);
      if (count < 0 || plcStart + size > clxEnd) break;
      const characterPositions: number[] = [];
      for (let index = 0; index <= count; index += 1) {
        characterPositions.push(tableStream.readUInt32LE(plcStart + index * 4));
      }
      const pcdStart = plcStart + (count + 1) * 4;
      pieces = [];
      for (let index = 0; index < count; index += 1) {
        const fc = tableStream.readUInt32LE(pcdStart + index * 8 + 2);
        const compressed = (fc & 0x40000000) !== 0;
        pieces.push({
          start: characterPositions[index],
          end: characterPositions[index + 1],
          fileOffset: compressed ? (fc & 0x3fffffff) >>> 1 : fc & 0x3fffffff,
          compressed,
        });
      }
      break;
    }
  }

  if (pieces.length === 0) {
    // Fallback for very old or simple files without a piece table: the FIB
    // fcMin/fcMac range holds the main text as a single run.
    const fcMin = wordDocument.readUInt32LE(0x0018);
    const fcMac = wordDocument.readUInt32LE(0x001c);
    if (fcMac <= fcMin || fcMac > wordDocument.length) {
      throw new Error(
        'No readable text was found in this .doc file. Saving it as .docx and importing that copy keeps the most content.',
      );
    }
    const range = wordDocument.subarray(fcMin, fcMac);
    // UTF-16LE text has a zero high byte for Latin characters; ANSI does not.
    let zeroHighBytes = 0;
    let pairs = 0;
    for (let index = 1; index < Math.min(range.length, 512); index += 2) {
      pairs += 1;
      if (range[index] === 0) zeroHighBytes += 1;
    }
    const text = pairs > 0 && zeroHighBytes / pairs > 0.7 ? range.toString('utf16le') : cp1252.decode(range);
    const normalized = normalizeDocText(text);
    if (!normalized) throw new Error('No readable text was found in this .doc file.');
    return normalized;
  }

  const parts: string[] = [];
  for (const piece of pieces) {
    const characters = piece.end - piece.start;
    if (characters <= 0) continue;
    parts.push(
      decodePiece(wordDocument, piece.fileOffset, piece.compressed ? characters : characters * 2, piece.compressed),
    );
  }
  const normalized = normalizeDocText(parts.join(''));
  if (!normalized) {
    throw new Error(
      'No readable text was found in this .doc file. Saving it as .docx and importing that copy keeps the most content.',
    );
  }
  return normalized;
}
