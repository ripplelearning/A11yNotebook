const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: ' ',
  quot: '"',
};

export function decodeHtmlEntities(value: string) {
  return value.replace(/&(#(?:x[\da-f]+|\d+)|[a-z]+);/gi, (entity, reference: string) => {
    const normalized = reference.toLowerCase();
    if (normalized.startsWith('#')) {
      const codePoint = normalized.startsWith('#x')
        ? Number.parseInt(normalized.slice(2), 16)
        : Number.parseInt(normalized.slice(1), 10);
      if (!Number.isInteger(codePoint) || codePoint <= 0 || codePoint > 0x10ffff) return '\ufffd';
      if (codePoint >= 0xd800 && codePoint <= 0xdfff) return '\ufffd';
      return String.fromCodePoint(codePoint);
    }
    if (normalized === '#39') return "'";
    return NAMED_ENTITIES[normalized] ?? entity;
  });
}
