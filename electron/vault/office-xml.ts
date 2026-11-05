import {
  DOMParser,
  type Document as XmlDocument,
  type Element as XmlElement,
  type Node as XmlNode,
} from '@xmldom/xmldom';
import type { ZipEntry } from './zip-archive';

// XML helpers shared by the Office/OpenDocument package parsers
// (XLSX, PPTX, ODS, ODP). The DOCX parser predates this module and
// keeps its own copies. `label` names the format in error messages.
const MAX_XML_BYTES = 10 * 1024 * 1024;
const MAX_XML_DEPTH = 128;
const MAX_XML_ELEMENTS = 500_000;

function invalid(message: string): never {
  throw new Error(message);
}

export function decodeXml(bytes: Buffer, name: string, label: string) {
  if (bytes.length > MAX_XML_BYTES) invalid(`The ${label} XML part ${name} exceeds the 10 MiB XML limit.`);
  let text: string;
  try {
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
      text = new TextDecoder('utf-16le', { fatal: true }).decode(bytes.subarray(2));
    } else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
      text = new TextDecoder('utf-16be', { fatal: true }).decode(bytes.subarray(2));
    } else {
      text = new TextDecoder('utf-8', { fatal: true }).decode(
        bytes[0] === 0xef && bytes[1] === 0xbb ? bytes.subarray(3) : bytes,
      );
    }
  } catch {
    return invalid(`The ${label} XML part ${name} has an unsupported or malformed encoding.`);
  }
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(text))
    invalid(`${label} XML DTDs and entity declarations are not supported.`);
  return text;
}

export function validateXmlNesting(xml: string, name: string, label: string) {
  let depth = 0;
  let elements = 0;
  for (let index = 0; index < xml.length;) {
    const start = xml.indexOf('<', index);
    if (start < 0) break;
    if (xml.startsWith('<!--', start)) {
      const end = xml.indexOf('-->', start + 4);
      if (end < 0) invalid(`The ${label} XML part ${name} has an unterminated comment.`);
      index = end + 3;
      continue;
    }
    if (xml.startsWith('<![CDATA[', start)) {
      const end = xml.indexOf(']]>', start + 9);
      if (end < 0) invalid(`The ${label} XML part ${name} has an unterminated CDATA section.`);
      index = end + 3;
      continue;
    }
    if (xml.startsWith('<?', start)) {
      const end = xml.indexOf('?>', start + 2);
      if (end < 0) invalid(`The ${label} XML part ${name} has an unterminated processing instruction.`);
      index = end + 2;
      continue;
    }
    if (xml.startsWith('<!', start)) invalid(`The ${label} XML part ${name} contains an unsupported declaration.`);
    let end = start + 1;
    let quote = '';
    for (; end < xml.length; end += 1) {
      const character = xml[end];
      if (quote) {
        if (character === quote) quote = '';
      } else if (character === '"' || character === "'") quote = character;
      else if (character === '>') break;
    }
    if (end >= xml.length) invalid(`The ${label} XML part ${name} has an unterminated tag.`);
    const tag = xml.slice(start + 1, end).trim();
    if (tag.startsWith('/')) depth -= 1;
    else if (!tag.endsWith('/')) {
      depth += 1;
      elements += 1;
      if (depth > MAX_XML_DEPTH || elements > MAX_XML_ELEMENTS) {
        invalid(`The ${label} XML part ${name} exceeds the XML nesting or element limit.`);
      }
    }
    if (depth < 0) invalid(`The ${label} XML part ${name} has mismatched element nesting.`);
    index = end + 1;
  }
  if (depth !== 0) invalid(`The ${label} XML part ${name} has mismatched element nesting.`);
}

export function parseXml(
  entries: Map<string, ZipEntry>,
  name: string,
  label: string,
  required = true,
): XmlDocument | undefined {
  const entry = entries.get(name);
  if (!entry) {
    if (required) invalid(`The ${label} part ${name} is missing.`);
    return undefined;
  }
  const text = decodeXml(entry.bytes, name, label);
  validateXmlNesting(text, name, label);
  let parseError = false;
  let document: XmlDocument | undefined;
  try {
    document = new DOMParser({
      onError: () => {
        parseError = true;
      },
    }).parseFromString(text, 'application/xml');
  } catch {
    parseError = true;
  }
  if (parseError || !document || !document.documentElement || document.documentElement.nodeName === 'parsererror') {
    invalid(`The ${label} XML part ${name} is malformed.`);
  }
  return document;
}

export function childElements(node: XmlNode, name?: string) {
  const found: XmlElement[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    const element = child as XmlElement;
    const localName = element.localName || element.nodeName.split(':').at(-1);
    if (child.nodeType === 1 && (!name || localName === name)) found.push(element);
  }
  return found;
}

export function descendants(node: XmlNode, name: string, label: string, limit = 100_000) {
  const result: XmlElement[] = [];
  const pending = childElements(node).reverse();
  while (pending.length) {
    const element = pending.pop()!;
    const localName = element.localName || element.nodeName.split(':').at(-1);
    if (name === '*' || localName === name) result.push(element);
    if (result.length > limit) invalid(`The ${label} contains too many XML elements.`);
    pending.push(...childElements(element).reverse());
  }
  return result;
}

/** Concatenated text of an element's descendant text nodes. */
export function elementText(element: XmlElement | undefined): string {
  if (!element) return '';
  let text = '';
  const pending: XmlNode[] = [element];
  while (pending.length) {
    const node = pending.pop()!;
    if (node.nodeType === 3) text += node.nodeValue || '';
    else for (let child = node.firstChild; child; child = child.nextSibling) pending.push(child);
  }
  return text;
}

export function localNameOf(node: XmlNode): string {
  const element = node as XmlElement;
  return element.localName || element.nodeName.split(':').at(-1) || '';
}
