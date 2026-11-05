export interface TextMatch {
  index: number;
  length: number;
}

/**
 * All non-overlapping matches of query in text, left to right. An empty
 * query matches nothing. Case-insensitive search folds both sides before
 * comparing, so match offsets refer to the original text.
 */
export function findAllMatches(text: string, query: string, caseSensitive: boolean): TextMatch[] {
  if (!query) return [];
  const haystack = caseSensitive ? text : text.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();
  const matches: TextMatch[] = [];
  let from = 0;
  for (;;) {
    const index = haystack.indexOf(needle, from);
    if (index < 0) return matches;
    matches.push({ index, length: needle.length });
    from = index + needle.length;
  }
}

/**
 * A readable snippet of text around one match: up to `context` characters
 * on each side, whitespace collapsed to single spaces (notes carry line
 * breaks and indentation that would otherwise read as gaps), with an
 * ellipsis where text was cut. The matched text itself is kept verbatim,
 * so the snippet always contains the searched term.
 */
export function matchSnippet(text: string, match: TextMatch, context = 40): string {
  const start = Math.max(0, match.index - context);
  const end = Math.min(text.length, match.index + match.length + context);
  const snippet = text.slice(start, end).replace(/\s+/g, ' ').trim();
  const leading = start > 0 ? '… ' : '';
  const trailing = end < text.length ? ' …' : '';
  return `${leading}${snippet}${trailing}`;
}

/** One snippet per match of query in text, in document order. */
export function findMatchSnippets(
  text: string,
  query: string,
  caseSensitive: boolean,
  context = 40,
): string[] {
  return findAllMatches(text, query, caseSensitive).map((match) => matchSnippet(text, match, context));
}
