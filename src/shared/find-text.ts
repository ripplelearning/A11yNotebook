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
