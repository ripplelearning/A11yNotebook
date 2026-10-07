import { inflateRawSync } from 'node:zlib';
import path from 'node:path';
import {
  DOMParser,
  type Document as XmlDocument,
  type Element as XmlElement,
  type Node as XmlNode,
} from '@xmldom/xmldom';
import type { DocxParagraph, DocxRun, DocxStructure, DocxTable } from '../../src/shared/docx';

const MAX_ARCHIVE_BYTES = 40 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 50 * 1024 * 1024;
const MAX_ENTRIES = 10_000;
const MAX_ENTRY_BYTES = 20 * 1024 * 1024;
const MAX_XML_BYTES = 10 * 1024 * 1024;
const MAX_XML_DEPTH = 128;
const MAX_XML_ELEMENTS = 500_000;
const MAX_PARAGRAPHS = 10_000;
const MAX_MEDIA_BYTES = 20 * 1024 * 1024;
const MAX_MEDIA_ITEMS = 1_000;
const MAX_SEMANTIC_RUNS = 100_000;
const RASTER_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.webp': 'image/webp',
};
const UNSUPPORTED_ELEMENTS = new Map([
  ['ins', 'tracked changes'],
  ['del', 'tracked changes'],
  ['moveFrom', 'tracked changes'],
  ['moveTo', 'tracked changes'],
  ['commentRangeStart', 'comments'],
  ['commentReference', 'comments'],
  ['sdt', 'form fields or content controls'],
  ['fldSimple', 'form fields'],
  ['fldChar', 'form fields'],
  ['printerSettings', 'printer settings'],
  ['object', 'embedded objects'],
]);

interface ZipEntry {
  path: string;
  bytes: Buffer;
  mediaType?: string;
}

interface Relationship {
  type: string;
  target: string;
  external: boolean;
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

function decodeEntryName(bytes: Buffer, utf8: boolean) {
  if (utf8) {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      return invalid('The DOCX archive contains an invalid UTF-8 entry name.');
    }
  }
  return bytes.toString('latin1');
}

function readZipEntries(bytes: Buffer): Map<string, ZipEntry> {
  if (!bytes.length || bytes.length > MAX_ARCHIVE_BYTES) invalid('This DOCX is invalid or exceeds the 40 MiB archive limit.');
  const minEnd = Math.max(0, bytes.length - 65_557);
  let end = -1;
  for (let index = bytes.length - 22; index >= minEnd; index -= 1) {
    if (
      bytes.readUInt32LE(index) === 0x06054b50 &&
      index + 22 + bytes.readUInt16LE(index + 20) === bytes.length
    ) {
      end = index;
      break;
    }
  }
  if (end < 0) invalid('The DOCX ZIP archive is malformed or truncated.');
  if (bytes.readUInt16LE(end + 4) !== 0 || bytes.readUInt16LE(end + 6) !== 0) {
    invalid('Multi-disk DOCX archives are not supported.');
  }
  const diskEntries = bytes.readUInt16LE(end + 8);
  const count = bytes.readUInt16LE(end + 10);
  const directorySize = bytes.readUInt32LE(end + 12);
  const directoryOffset = bytes.readUInt32LE(end + 16);
  if (diskEntries !== count || count > MAX_ENTRIES || count === 0xffff || directoryOffset === 0xffffffff) {
    invalid('The DOCX ZIP entry count or format is unsupported.');
  }
  const directoryEnd = directoryOffset + directorySize;
  if (directoryEnd !== end || directoryEnd > bytes.length) invalid('The DOCX ZIP directory is malformed.');

  const metadata: Array<{
    path: string;
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
      invalid('The DOCX central directory is malformed.');
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
    if (recordEnd > directoryEnd || !nameLength || disk !== 0) invalid('The DOCX ZIP entry record is invalid.');
    const name = decodeEntryName(bytes.subarray(nameStart, nameStart + nameLength), Boolean(flags & 0x800));
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
      invalid('The DOCX ZIP contains a traversal, absolute, or over-deep entry path.');
    }
    if (madeBy >> 8 === 3 && unixMode === 0xa000) invalid('Symbolic links are not supported in DOCX archives.');
    if (flags & 1) invalid('Encrypted DOCX ZIP entries are not supported.');
    if (flags & 0x40) invalid('Strongly encrypted DOCX ZIP entries are not supported.');
    if (flags & ~(0x800 | 0x8 | 0x6)) invalid('The DOCX archive uses unsupported ZIP flags.');
    if (![0, 8].includes(method)) invalid('The DOCX archive uses an unsupported compression method.');
    if (compressedSize === 0xffffffff || expandedSize === 0xffffffff || localOffset === 0xffffffff) {
      invalid('ZIP64 DOCX archives are not supported.');
    }
    if (expandedSize > MAX_ENTRY_BYTES || compressedSize > MAX_ARCHIVE_BYTES) {
      invalid('A DOCX archive entry exceeds the per-entry size limit.');
    }
    expandedTotal += expandedSize;
    if (expandedTotal > MAX_EXPANDED_BYTES) invalid('The DOCX archive expands beyond the 50 MiB limit.');
    if (names.has(normalized.toLowerCase())) invalid('The DOCX archive contains duplicate entry names.');
    names.add(normalized.toLowerCase());
    if (!isDirectory) metadata.push({ path: normalized, flags, method, crc, compressedSize, expandedSize, localOffset });
    cursor = recordEnd;
  }
  if (cursor !== directoryEnd) invalid('The DOCX ZIP directory length is inconsistent.');

  const entries = new Map<string, ZipEntry>();
  for (const item of metadata) {
    const offset = item.localOffset;
    if (offset + 30 > directoryOffset || bytes.readUInt32LE(offset) !== 0x04034b50) {
      invalid('A DOCX ZIP entry has an invalid local header.');
    }
    const flags = bytes.readUInt16LE(offset + 6);
    const method = bytes.readUInt16LE(offset + 8);
    const localNameLength = bytes.readUInt16LE(offset + 26);
    const localExtraLength = bytes.readUInt16LE(offset + 28);
    const dataStart = offset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + item.compressedSize;
    const localName = decodeEntryName(bytes.subarray(offset + 30, offset + 30 + localNameLength), Boolean(flags & 0x800));
    if (
      flags !== item.flags ||
      method !== item.method ||
      localName !== item.path ||
      dataStart < offset + 30 + localNameLength ||
      dataStart > directoryOffset ||
      dataEnd > directoryOffset
    ) {
      invalid('A DOCX ZIP entry has inconsistent local and central headers.');
    }
    if (!(flags & 0x8)) {
      if (
        bytes.readUInt32LE(offset + 14) !== item.crc ||
        bytes.readUInt32LE(offset + 18) !== item.compressedSize ||
        bytes.readUInt32LE(offset + 22) !== item.expandedSize
      ) {
        invalid('A DOCX ZIP entry has inconsistent local size or checksum metadata.');
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
      invalid('A DOCX ZIP entry is malformed or exceeds the decompression limit.');
    }
    if (content.length !== item.expandedSize || crc32(content) !== item.crc) {
      invalid('A DOCX ZIP entry failed its size or checksum validation.');
    }
    entries.set(item.path, { path: item.path, bytes: content });
  }
  dataRanges.sort((left, right) => left[0] - right[0]);
  for (let index = 1; index < dataRanges.length; index += 1) {
    if (dataRanges[index][0] < dataRanges[index - 1][1]) invalid('DOCX ZIP entries overlap.');
  }
  return entries;
}

function decodeXml(bytes: Buffer, name: string) {
  if (bytes.length > MAX_XML_BYTES) invalid(`The DOCX XML part ${name} exceeds the 10 MiB XML limit.`);
  let text: string;
  try {
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
      text = new TextDecoder('utf-16le', { fatal: true }).decode(bytes.subarray(2));
    } else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
      text = new TextDecoder('utf-16be', { fatal: true }).decode(bytes.subarray(2));
    } else {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes[0] === 0xef && bytes[1] === 0xbb ? bytes.subarray(3) : bytes);
    }
  } catch {
    return invalid(`The DOCX XML part ${name} has an unsupported or malformed encoding.`);
  }
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(text)) invalid('DOCX XML DTDs and entity declarations are not supported.');
  return text;
}

function validateXmlNesting(xml: string, name: string) {
  let depth = 0;
  let elements = 0;
  for (let index = 0; index < xml.length; ) {
    const start = xml.indexOf('<', index);
    if (start < 0) break;
    if (xml.startsWith('<!--', start)) {
      const end = xml.indexOf('-->', start + 4);
      if (end < 0) invalid(`The DOCX XML part ${name} has an unterminated comment.`);
      index = end + 3;
      continue;
    }
    if (xml.startsWith('<![CDATA[', start)) {
      const end = xml.indexOf(']]>', start + 9);
      if (end < 0) invalid(`The DOCX XML part ${name} has an unterminated CDATA section.`);
      index = end + 3;
      continue;
    }
    if (xml.startsWith('<?', start)) {
      const end = xml.indexOf('?>', start + 2);
      if (end < 0) invalid(`The DOCX XML part ${name} has an unterminated processing instruction.`);
      index = end + 2;
      continue;
    }
    if (xml.startsWith('<!', start)) invalid(`The DOCX XML part ${name} contains an unsupported declaration.`);
    let end = start + 1;
    let quote = '';
    for (; end < xml.length; end += 1) {
      const character = xml[end];
      if (quote) {
        if (character === quote) quote = '';
      } else if (character === '"' || character === "'") quote = character;
      else if (character === '>') break;
    }
    if (end >= xml.length) invalid(`The DOCX XML part ${name} has an unterminated tag.`);
    const tag = xml.slice(start + 1, end).trim();
    if (tag.startsWith('/')) depth -= 1;
    else if (!tag.endsWith('/')) {
      depth += 1;
      elements += 1;
      if (depth > MAX_XML_DEPTH || elements > MAX_XML_ELEMENTS) {
        invalid(`The DOCX XML part ${name} exceeds the XML nesting or element limit.`);
      }
    }
    if (depth < 0) invalid(`The DOCX XML part ${name} has mismatched element nesting.`);
    index = end + 1;
  }
  if (depth !== 0) invalid(`The DOCX XML part ${name} has mismatched element nesting.`);
}

function parseXml(entries: Map<string, ZipEntry>, name: string, required = true): XmlDocument | undefined {
  const entry = entries.get(name);
  if (!entry) {
    if (required) invalid(`The DOCX part ${name} is missing.`);
    return undefined;
  }
  const text = decodeXml(entry.bytes, name);
  validateXmlNesting(text, name);
  let parseError = false;
  const document = new DOMParser({
    onError: () => {
      parseError = true;
    },
  }).parseFromString(text, 'application/xml');
  if (parseError || !document.documentElement || document.documentElement.nodeName === 'parsererror') {
    invalid(`The DOCX XML part ${name} is malformed.`);
  }
  return document;
}

function childElements(node: XmlNode, name?: string) {
  const found: XmlElement[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    const element = child as XmlElement;
    const localName = element.localName || element.nodeName.split(':').at(-1);
    if (child.nodeType === 1 && (!name || localName === name)) found.push(element);
  }
  return found;
}

function descendants(node: XmlNode, name: string, limit = 100_000) {
  const result: XmlElement[] = [];
  const pending = childElements(node).reverse();
  while (pending.length) {
    const element = pending.pop()!;
    const localName = element.localName || element.nodeName.split(':').at(-1);
    if (name === '*' || localName === name) result.push(element);
    if (result.length > limit) invalid('The DOCX contains too many XML elements.');
    pending.push(...childElements(element).reverse());
  }
  return result;
}

function attr(element: XmlElement | undefined, name: string) {
  if (!element) return '';
  return (
    element.getAttributeNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', name) ||
    element.getAttribute(name) ||
    ''
  );
}

function relationshipPart(source: string) {
  const directory = source.includes('/') ? source.slice(0, source.lastIndexOf('/') + 1) : '';
  const basename = source.slice(directory.length);
  return `${directory}_rels/${basename}.rels`;
}

function resolvePart(source: string, target: string) {
  if (
    !target ||
    target.startsWith('/') ||
    target.includes('\\') ||
    /^[a-z][a-z\d+.-]*:/i.test(target) ||
    target.includes('\0')
  ) {
    invalid('A DOCX relationship contains an unsafe internal target.');
  }
  let decodedTarget: string;
  try {
    decodedTarget = decodeURIComponent(target);
  } catch {
    return invalid('A DOCX relationship target has invalid URL encoding.');
  }
  const resolved = path.posix.normalize(
    path.posix.join(path.posix.dirname(source), decodedTarget),
  );
  if (resolved === '..' || resolved.startsWith('../') || resolved.startsWith('/')) {
    invalid('A DOCX relationship target leaves the document package.');
  }
  return resolved;
}

function safeHyperlink(target: string) {
  if (
    !target ||
    [...target].some((character) => {
      const point = character.codePointAt(0)!;
      return point <= 0x20 || point === 0x7f;
    }) ||
    target.startsWith('//')
  ) {
    invalid('A DOCX hyperlink uses an unsafe URL.');
  }
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    invalid('A DOCX hyperlink is not a valid URL.');
  }
  if (!['http:', 'https:', 'mailto:'].includes(url.protocol) || (url.protocol !== 'mailto:' && (url.username || url.password))) {
    invalid('A DOCX hyperlink uses an unsupported or command-like protocol.');
  }
  return url.href;
}

function relationships(entries: Map<string, ZipEntry>, source: string) {
  const part = relationshipPart(source);
  const document = parseXml(entries, part, false);
  const result = new Map<string, Relationship>();
  if (!document) return result;
  if (
    (document.documentElement?.localName || document.documentElement?.nodeName) !== 'Relationships' ||
    document.documentElement?.namespaceURI !== 'http://schemas.openxmlformats.org/package/2006/relationships'
  ) {
    invalid(`The DOCX relationships part ${part} is malformed.`);
  }
  for (const element of descendants(document, 'Relationship')) {
    const id = element.getAttribute('Id') || '';
    const type = element.getAttribute('Type') || '';
    const target = element.getAttribute('Target') || '';
    const targetMode = (element.getAttribute('TargetMode') || '').toLowerCase();
    if (targetMode && targetMode !== 'external' && targetMode !== 'internal') {
      invalid(`The DOCX relationships part ${part} has an invalid target mode.`);
    }
    const external = targetMode === 'external';
    if (!id || !type || !target || result.has(id)) invalid(`The DOCX relationships part ${part} is invalid.`);
    if (type.includes('digital-signature')) invalid('Digitally signed DOCX files are not supported.');
    if (external) {
      if (!type.endsWith('/hyperlink')) invalid('External data and resource relationships are not supported in DOCX files.');
      result.set(id, { type, target: safeHyperlink(target), external: true });
    } else {
      result.set(id, { type, target: resolvePart(source, target), external: false });
    }
  }
  return result;
}

function checkRejectedParts(entries: Map<string, ZipEntry>) {
  for (const entry of entries.values()) {
    const name = entry.path.toLowerCase();
    if (
      /(?:^|\/)(?:vbaproject\.bin|activeX|embeddings|oleobjects|externallinks|printersettings|fonts)(?:\/|\.|$)/i.test(name) ||
      name.startsWith('_xmlsignatures/') ||
      /(?:^|\/)(?:connections|querytables|externaldata)(?:\/|\.|$)/i.test(name)
    ) {
      invalid(`DOCX content is not supported: ${entry.path}.`);
    }
    if (/\.(?:zip|docx)$/i.test(name)) invalid('Nested DOCX and ZIP archives are not supported.');
    if (/\.(?:zip|docx|xls[xmb]?|ppt[xm]?|bin)$/i.test(name) && /(?:embedding|oleobject|package)/i.test(name)) {
      invalid('Embedded documents and OLE objects are not supported in DOCX files.');
    }
  }
}

function parseContentTypes(entries: Map<string, ZipEntry>) {
  const document = parseXml(entries, '[Content_Types].xml')!;
  const root = document.documentElement;
  if (
    !root ||
    (root.localName || root.nodeName) !== 'Types' ||
    root.namespaceURI !== 'http://schemas.openxmlformats.org/package/2006/content-types'
  ) {
    invalid('The DOCX [Content_Types].xml part is malformed.');
  }
  const types = new Map<string, string>();
  for (const element of childElements(root)) {
    const localName = element.localName || element.nodeName.split(':').at(-1);
    if (localName !== 'Default' && localName !== 'Override') {
      invalid('The DOCX [Content_Types].xml part contains an invalid entry.');
    }
    const contentType = element.getAttribute('ContentType') || '';
    const key =
      localName === 'Default'
        ? `.${(element.getAttribute('Extension') || '').toLowerCase()}`
        : (element.getAttribute('PartName') || '').replace(/^\/+/, '');
    if (!contentType || !key || types.has(key)) invalid('The DOCX [Content_Types].xml part contains invalid or duplicate types.');
    types.set(key, contentType.toLowerCase());
  }
  if (![...types.values()].some((type) => type.includes('wordprocessingml.document.main+xml'))) {
    invalid('The archive is not an Office Open XML Word document.');
  }
  for (const [name, contentType] of types) {
    if (/macroenabled|vba|activex|oleobject|externallink/i.test(`${name} ${contentType}`)) {
      invalid('Macro-enabled, ActiveX, and OLE DOCX content is not supported.');
    }
  }
}

function contentTypes(entries: Map<string, ZipEntry>) {
  const document = parseXml(entries, '[Content_Types].xml')!;
  const root = document.documentElement;
  if (!root) return new Map<string, string>();
  const types = new Map<string, string>();
  for (const element of childElements(root)) {
    const localName = element.localName || element.nodeName.split(':').at(-1);
    const key =
      localName === 'Override'
        ? (element.getAttribute('PartName') || '').replace(/^\/+/, '')
        : `.${(element.getAttribute('Extension') || '').toLowerCase()}`;
    if (key) types.set(key, (element.getAttribute('ContentType') || '').toLowerCase());
  }
  return types;
}

function contentTypeFor(types: Map<string, string>, part: string) {
  return types.get(part) ?? types.get(`.${part.slice(part.lastIndexOf('.') + 1).toLowerCase()}`) ?? '';
}

function validRasterSignature(type: string, bytes: Buffer) {
  if (type === 'image/png') return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (type === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === 'image/gif') return bytes.subarray(0, 6).toString('ascii').match(/^GIF8[79]a$/) !== null;
  if (type === 'image/bmp') return bytes.subarray(0, 2).toString('ascii') === 'BM';
  if (type === 'image/tiff') {
    return (
      bytes.length >= 4 &&
      ((bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0) ||
        (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0 && bytes[3] === 0x2a))
    );
  }
  if (type === 'image/webp') {
    return bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
  }
  return false;
}

function findRelationshipByType(map: Map<string, Relationship>, suffix: string) {
  return [...map].find(([, relationship]) => relationship.type.endsWith(`/${suffix}`));
}

function safeText(value: string, maximum = 2_000) {
  return [...value]
    .filter((character) => {
      const point = character.codePointAt(0)!;
      return point >= 0x20 || point === 9 || point === 10 || point === 13;
    })
    .join('')
    .trim()
    .slice(0, maximum);
}

function elementText(element: XmlElement | undefined) {
  return element?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

function wChild(element: XmlElement, name: string) {
  return childElements(element, name)[0];
}

function boolProperty(element: XmlElement | undefined, name: string) {
  const property = element && wChild(element, name);
  if (!property) return false;
  const value = attr(property, 'val');
  return value !== '0' && value !== 'false' && value !== 'off';
}

function collectUnsupported(document: XmlDocument, extra: Set<string>) {
  for (const [element, feature] of UNSUPPORTED_ELEMENTS) {
    if (descendants(document, element).length) extra.add(feature);
  }
  if (descendants(document, 'instrText').length) extra.add('fields');
  if (descendants(document, 'watermark').length || descendants(document, 'background').length) {
    extra.add('watermarks');
  }
  if (descendants(document, 'embedRegular').length || descendants(document, 'embedBold').length) {
    extra.add('embedded fonts');
  }
}

function runFormatting(run: XmlElement): Pick<DocxRun, 'bold' | 'italic' | 'underline' | 'strike' | 'style'> {
  const properties = wChild(run, 'rPr');
  const font = wChild(properties ?? run, 'rStyle');
  const style = attr(font, 'val');
  return {
    ...(boolProperty(properties, 'b') ? { bold: true } : {}),
    ...(boolProperty(properties, 'i') ? { italic: true } : {}),
    ...(boolProperty(properties, 'u') ? { underline: true } : {}),
    ...(boolProperty(properties, 'strike') ? { strike: true } : {}),
    ...(style ? { style } : {}),
  };
}

function runText(run: XmlElement) {
  const result: string[] = [];
  const visit = (element: XmlElement) => {
    for (const child of childElements(element)) {
      if (child.localName === 't') result.push(child.textContent ?? '');
      else if (child.localName === 'tab') result.push('\t');
      else if (child.localName === 'br' || child.localName === 'cr') result.push('\n');
      else if (child.localName !== 'rPr' && child.localName !== 'drawing' && child.localName !== 'pict') visit(child);
    }
  };
  visit(run);
  return [...result.join('')]
    .filter((character) => {
      const point = character.codePointAt(0)!;
      return point >= 0x20 || point === 9 || point === 10 || point === 13;
    })
    .join('');
}

function numberingMap(entries: Map<string, ZipEntry>) {
  const result = new Map<string, Map<number, { ordered: boolean }>>();
  const document = parseXml(entries, 'word/numbering.xml', false);
  if (!document) return result;
  const abstract = new Map<string, Map<number, { ordered: boolean }>>();
  for (const item of descendants(document, 'abstractNum')) {
    const id = attr(item, 'abstractNumId');
    const levels = new Map<number, { ordered: boolean }>();
    for (const level of childElements(item, 'lvl')) {
      const index = Number(attr(level, 'ilvl'));
      const format = attr(wChild(level, 'numFmt'), 'val');
      if (Number.isInteger(index) && index >= 0 && index <= 8) levels.set(index, { ordered: format !== 'bullet' });
    }
    abstract.set(id, levels);
  }
  for (const item of descendants(document, 'num')) {
    const numberId = attr(item, 'numId');
    const abstractId = attr(wChild(item, 'abstractNumId'), 'val');
    if (numberId && abstract.has(abstractId)) result.set(numberId, abstract.get(abstractId)!);
  }
  return result;
}

function styleHeadings(entries: Map<string, ZipEntry>) {
  const headings = new Map<string, number>();
  const document = parseXml(entries, 'word/styles.xml', false);
  if (!document) return headings;
  for (const style of descendants(document, 'style')) {
    const id = attr(style, 'styleId');
    const styleProperties = wChild(style, 'pPr');
    const outline = attr(wChild(styleProperties ?? style, 'outlineLvl'), 'val');
    const name = attr(wChild(style, 'name'), 'val');
    const level = outline !== '' ? Number(outline) + 1 : /^heading\s*([1-9])$/i.exec(name)?.[1];
    if (id && level !== undefined && Number(level) >= 1 && Number(level) <= 9) headings.set(id, Number(level));
  }
  return headings;
}

function paragraphText(paragraph: DocxParagraph) {
  return paragraph.runs.map((run) => run.text).join('');
}

function parseParagraph(
  element: XmlElement,
  blockIndex: number,
  entries: Map<string, ZipEntry>,
  runRelationships: Map<string, Relationship>,
  headings: Map<string, number>,
  numbering: Map<string, Map<number, { ordered: boolean }>>,
  links: DocxStructure['links'],
  unsupported: Set<string>,
  countRun: () => void,
): DocxParagraph {
  const properties = wChild(element, 'pPr');
  const styleId = attr(wChild(properties ?? element, 'pStyle'), 'val');
  const level = styleId ? headings.get(styleId) : undefined;
  const outlineLevel = attr(wChild(properties ?? element, 'outlineLvl'), 'val');
  const headingLevel = level ?? (outlineLevel !== '' ? Number(outlineLevel) + 1 : undefined);
  const numProperties = wChild(properties ?? element, 'numPr');
  const numberId = attr(wChild(numProperties ?? element, 'numId'), 'val');
  const listLevel = Number(attr(wChild(numProperties ?? element, 'ilvl'), 'val') || '0');
  const numDefinition = numbering.get(numberId)?.get(listLevel);
  const runs: DocxRun[] = [];
  const breaks: Array<'page' | 'column'> = [];
  for (const child of childElements(element)) {
    if (child.localName === 'pPr') continue;
    if (child.localName === 'hyperlink') {
      const linkId =
        child.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') ||
        child.getAttribute('r:id') ||
        '';
      const rel = runRelationships.get(linkId);
      for (const run of childElements(child, 'r')) {
        countRun();
        const text = runText(run).slice(0, 20_000);
        if (!text) continue;
        if (!rel?.external || !rel.type.endsWith('/hyperlink')) invalid('A DOCX hyperlink has no safe external target.');
        const target = safeHyperlink(rel.target);
        runs.push({ text, ...runFormatting(run), link: target });
        links.push({ text, target, blockIndex });
      }
    } else if (child.localName === 'r') {
      countRun();
      const text = runText(child).slice(0, 20_000);
      if (text) runs.push({ text, ...runFormatting(child) });
      for (const br of descendants(child, 'br')) {
        const type = attr(br, 'type');
        if (type === 'page' || type === 'column') breaks.push(type);
      }
      if (descendants(child, 'lastRenderedPageBreak').length) breaks.push('page');
      for (const drawing of descendants(child, 'drawing')) {
        const docPr = descendants(drawing, 'docPr')[0];
        const description = docPr?.getAttribute('descr') || docPr?.getAttribute('title') || '';
        const blip = descendants(drawing, 'blip')[0];
        const relId =
          blip?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'embed') ||
          blip?.getAttribute('r:embed') ||
          '';
        const rel = blip && runRelationships.get(relId);
        if (rel && !rel.external && rel.type.endsWith('/image')) {
          const extension = rel.target.slice(rel.target.lastIndexOf('.')).toLowerCase();
          const mediaType = RASTER_TYPES[extension];
          const sourceEntry = entries.get(rel.target);
          if (mediaType && sourceEntry && validRasterSignature(mediaType, sourceEntry.bytes)) {
            runs.push({ text: '', image: { altText: safeText(description), mediaType } });
          } else {
            unsupported.add('non-raster images');
          }
        } else if (blip) {
          invalid('Externally linked DOCX images are not supported.');
        }
      }
    } else if (child.localName === 'bookmarkStart' || child.localName === 'bookmarkEnd' || child.localName === 'proofErr') {
      continue;
    } else if (child.localName === 'sdt') {
      unsupported.add('form fields or content controls');
    }
  }
  const text = paragraphText({ kind: 'paragraph', runs, text: '' });
  const sectionBreak = Boolean(wChild(properties ?? element, 'sectPr'));
  return {
    kind: 'paragraph',
    text,
    runs,
    ...(styleId ? { styleId } : {}),
    ...(headingLevel && headingLevel >= 1 && headingLevel <= 9 ? { headingLevel } : {}),
    ...(numDefinition && listLevel >= 0 && listLevel <= 8
      ? { list: { ordered: numDefinition.ordered, level: listLevel } }
      : {}),
    ...(breaks.length ? { breaks } : {}),
    ...(sectionBreak ? { sectionBreak: true } : {}),
  };
}

function parseDocx(entries: Map<string, ZipEntry>): DocxStructure {
  checkRejectedParts(entries);
  parseContentTypes(entries);
  const declaredTypes = contentTypes(entries);
  const relParts = [...entries.keys()].filter((name) => name.endsWith('.rels'));
  for (const part of relParts) {
    const source = part === '_rels/.rels' ? '' : part.replace(/(^|\/)_rels\//, '$1').replace(/\.rels$/, '');
    relationships(entries, source);
  }
  if (entries.has('word/comments.xml') || entries.has('word/commentsExtended.xml')) {
    invalid('DOCX comments are not supported.');
  }
  const rootRels = relationships(entries, '');
  const officeDocument = findRelationshipByType(rootRels, 'officeDocument');
  if (!officeDocument || officeDocument[1].external) invalid('The DOCX main document relationship is missing or external.');
  const documentPath = officeDocument[1].target;
  if (!contentTypeFor(declaredTypes, documentPath).includes('wordprocessingml.document.main+xml')) {
    invalid('The DOCX main document content type is invalid.');
  }
  const document = parseXml(entries, documentPath)!;
  const root = document.documentElement;
  if (
    !root ||
    (root.localName || root.nodeName) !== 'document' ||
    root.namespaceURI !== 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
  ) {
    invalid('The DOCX main document XML is malformed.');
  }
  const body = descendants(document, 'body')[0];
  if (!body) invalid('The DOCX main document body is missing.');
  const runRelationships = relationships(entries, documentPath);
  let mediaItems = 0;
  for (const relationship of runRelationships.values()) {
    if (!relationship.external && relationship.type.endsWith('/image')) {
      mediaItems += 1;
      if (mediaItems > MAX_MEDIA_ITEMS) invalid('The DOCX contains too many embedded images.');
      const entry = entries.get(relationship.target);
      if (!entry) invalid('A DOCX image relationship points to a missing part.');
      const type = contentTypeFor(declaredTypes, relationship.target);
      const extension = relationship.target.slice(relationship.target.lastIndexOf('.')).toLowerCase();
      if (!RASTER_TYPES[extension] || !type.startsWith('image/') || type.includes('svg')) {
        continue;
      }
      if (
        entry.bytes.length > MAX_MEDIA_BYTES ||
        !validRasterSignature(RASTER_TYPES[extension], entry.bytes)
      ) {
        invalid('A DOCX raster image exceeds size limits or has an invalid image signature.');
      }
    }
  }

  const headings = styleHeadings(entries);
  const numbering = numberingMap(entries);
  const unsupported = new Set<string>();
  collectUnsupported(document, unsupported);
  const blocks: DocxStructure['blocks'] = [];
  const headingItems: DocxStructure['headings'] = [];
  const links: DocxStructure['links'] = [];
  let paragraphCount = 0;
  let semanticRuns = 0;
  let truncated = false;
  let tableCount = 0;
  const paragraph = (node: XmlElement) => {
    if (paragraphCount >= MAX_PARAGRAPHS) {
      truncated = true;
      return null;
    }
    paragraphCount += 1;
    const current = parseParagraph(
      node,
      blocks.length,
      entries,
      runRelationships,
      headings,
      numbering,
      links,
      unsupported,
      () => {
        semanticRuns += 1;
        if (semanticRuns > MAX_SEMANTIC_RUNS) invalid('The DOCX contains too many text runs.');
      },
    );
    if (current.headingLevel) headingItems.push({ level: current.headingLevel, text: current.text, blockIndex: blocks.length });
    return current;
  };
  const parseTable = (tableElement: XmlElement, depth: number): DocxTable => {
    if (depth > 32) invalid('The DOCX table nesting exceeds the supported depth.');
    tableCount += 1;
    if (tableCount > 10_000) invalid('The DOCX contains too many tables.');
    const rows = childElements(tableElement, 'tr').map((row) => ({
      cells: childElements(row, 'tc').map((cell) => ({
        paragraphs: childElements(cell)
          .flatMap((item) => {
            if (item.localName === 'p') {
              const parsed = paragraph(item);
              return parsed ? [parsed] : [];
            }
            if (item.localName === 'tbl') {
              const nested = parseTable(item, depth + 1);
              return nested.rows.flatMap((nestedRow) => nestedRow.cells.flatMap((nestedCell) => nestedCell.paragraphs));
            }
            return [];
          }),
      })),
    }));
    return { kind: 'table', rows };
  };
  for (const child of childElements(body)) {
    if (child.localName === 'p') {
      const current = paragraph(child);
      if (!current) break;
      blocks.push(current);
    } else if (child.localName === 'tbl') {
      blocks.push(parseTable(child, 0));
      if (truncated) break;
    }
  }
  const propertiesPath = [...entries.keys()].find((name) => /^docProps\/core\.xml$/i.test(name));
  const properties = propertiesPath ? parseXml(entries, propertiesPath, false) : undefined;
  const propertyText = (name: string) => {
    if (!properties) return undefined;
    const element = descendants(properties, name)[0];
    const value = safeText(elementText(element), 250);
    return value || undefined;
  };
  const createdValue = propertyText('created');
  const createdDate = createdValue ? new Date(createdValue) : undefined;
  const sectionCount = Math.max(
    1,
    descendants(document, 'sectPr').length,
    blocks.filter((block) => block.kind === 'paragraph' && block.sectionBreak).length + 1,
  );
  return {
    ...(propertyText('title') ? { title: propertyText('title') } : {}),
    ...(propertyText('creator') ? { author: propertyText('creator') } : {}),
    ...(createdDate && Number.isFinite(createdDate.getTime()) ? { created: createdDate.toISOString() } : {}),
    blocks,
    headings: headingItems,
    links,
    sectionCount,
    unsupportedFeatures: [...unsupported].map((feature) => `${feature} (content not included)`),
    truncated,
    ...(truncated ? { truncationReason: `Only the first ${MAX_PARAGRAPHS} paragraphs were included.` } : {}),
  };
}

export function parseDocxStructure(bytes: Buffer): DocxStructure {
  const entries = readZipEntries(bytes);
  return parseDocx(entries);
}

export function docxSearchText(structure: DocxStructure, maximum = 4 * 1024 * 1024) {
  const content: string[] = [];
  let size = 0;
  const append = (value: string) => {
    const remaining = maximum - size;
    if (remaining <= 0) return false;
    const text = value.slice(0, remaining);
    content.push(text);
    size += text.length;
    return text.length === value.length;
  };
  for (const block of structure.blocks) {
    if (block.kind === 'paragraph') {
      if (!append(block.text)) break;
    } else {
      let done = false;
      for (const row of block.rows) {
        for (const cell of row.cells) {
          for (const paragraph of cell.paragraphs) {
            if (!append(paragraph.text)) {
              done = true;
              break;
            }
          }
          if (done) break;
        }
        if (done) break;
      }
      if (done) break;
    }
  }
  return content.join('\n');
}
