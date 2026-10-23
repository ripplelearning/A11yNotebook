/**
 * Builds a minimal but structurally real Word 97-2003 .doc file (OLE/CFB
 * container + FIB + CLX piece table) for extractor tests. Pieces may be
 * ANSI-"compressed" (Latin-1 bytes, the format Word uses for Latin text) or
 * uncompressed UTF-16LE.
 */
export function buildDocFixture(
  pieces: Array<{ text: string; compressed: boolean }>,
  options: { wordIdent?: number } = {},
): Buffer {
  const sectorSize = 512;
  const wordDocument = Buffer.alloc(0x800 + 0x400);
  wordDocument.writeUInt16LE(options.wordIdent ?? 0xa5ec, 0);
  wordDocument.writeUInt16LE(0, 0x000a); // flags: use the 0Table stream

  let pieceOffset = 0x400;
  const pieceData: Array<{ fc: number; chars: number }> = [];
  for (const piece of pieces) {
    const encoded = piece.compressed ? Buffer.from(piece.text, 'latin1') : Buffer.from(piece.text, 'utf16le');
    encoded.copy(wordDocument, pieceOffset);
    pieceData.push({
      fc: piece.compressed ? 0x40000000 | (pieceOffset * 2) : pieceOffset,
      chars: piece.text.length,
    });
    pieceOffset += encoded.length;
  }
  const wordStream = wordDocument.subarray(0, pieceOffset);

  // CLX: one PlcPcd (0x02) with cumulative character positions and PCDs.
  const count = pieces.length;
  const lcb = 4 + (count + 1) * 4 + count * 8;
  const clx = Buffer.alloc(1 + 4 + lcb);
  clx[0] = 0x02;
  clx.writeUInt32LE(lcb, 1);
  let position = 0;
  for (let index = 0; index <= count; index += 1) {
    clx.writeUInt32LE(position, 5 + index * 4);
    if (index < count) position += pieceData[index].chars;
  }
  const pcdStart = 5 + (count + 1) * 4;
  pieceData.forEach((piece, index) => {
    clx.writeUInt32LE(piece.fc, pcdStart + index * 8 + 2);
  });
  const tableStream = clx;

  wordDocument.writeInt32LE(0, 0x01a2); // fcClx
  wordDocument.writeUInt32LE(clx.length, 0x01a6); // lcbClx

  const streamSectors = (stream: Buffer) => Math.max(1, Math.ceil(stream.length / sectorSize));
  const fatSector = 0;
  const directorySector = 1;
  const wordStart = 2;
  const tableStart = wordStart + streamSectors(wordStream);

  const directory = Buffer.alloc(sectorSize);
  const writeEntry = (index: number, name: string, type: number, start: number, size: number) => {
    const offset = index * 128;
    directory.write(name, offset, 'utf16le');
    directory.writeUInt16LE((name.length + 1) * 2, offset + 64);
    directory[offset + 66] = type;
    directory.writeUInt32LE(start, offset + 116);
    directory.writeBigUInt64LE(BigInt(size), offset + 120);
  };
  writeEntry(0, 'Root Entry', 5, 0xfffffffe, 0);
  writeEntry(1, 'WordDocument', 2, wordStart, wordStream.length);
  writeEntry(2, '0Table', 2, tableStart, tableStream.length);

  const totalSectors = tableStart + streamSectors(tableStream);
  const fat = Buffer.alloc(sectorSize);
  for (let sector = 0; sector < totalSectors; sector += 1) fat.writeUInt32LE(0xfffffffe, sector * 4);
  fat.writeUInt32LE(0xfffffffd, fatSector * 4); // FAT sector itself
  for (let index = 0; index < streamSectors(wordStream) - 1; index += 1) {
    fat.writeUInt32LE(wordStart + index + 1, (wordStart + index) * 4);
  }
  for (let index = 0; index < streamSectors(tableStream) - 1; index += 1) {
    fat.writeUInt32LE(tableStart + index + 1, (tableStart + index) * 4);
  }

  const header = Buffer.alloc(sectorSize);
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(header, 0);
  header.writeUInt16LE(9, 30); // 512-byte sectors
  header.writeUInt16LE(6, 32); // 64-byte mini sectors
  header.writeUInt32LE(directorySector, 48);
  header.writeUInt32LE(4096, 56); // mini stream cutoff
  header.writeUInt32LE(0xfffffffe, 60); // no MiniFAT
  header.writeUInt32LE(0, 64);
  header.writeUInt32LE(0xfffffffe, 68); // no extra DIFAT
  header.writeUInt32LE(0, 72);
  for (let index = 0; index < 109; index += 1) header.writeUInt32LE(0xffffffff, 76 + index * 4);
  header.writeUInt32LE(fatSector, 76);

  // File layout: the 512-byte header, then sectors 0..totalSectors-1.
  const bySector: Buffer[] = Array.from({ length: totalSectors }, () => Buffer.alloc(sectorSize));
  const place = (start: number, stream: Buffer) => {
    for (let index = 0; index < streamSectors(stream); index += 1) {
      stream.copy(bySector[start + index], 0, index * sectorSize, (index + 1) * sectorSize);
    }
  };
  fat.copy(bySector[fatSector]);
  directory.copy(bySector[directorySector]);
  place(wordStart, wordStream);
  place(tableStart, tableStream);
  return Buffer.concat([header, ...bySector]);
}
