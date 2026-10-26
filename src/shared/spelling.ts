/**
 * Local spelling and grammar checking for notes. Spelling uses the bundled
 * Hunspell en-US dictionary (dictionary-en, MIT AND BSD) through nspell;
 * nothing is sent anywhere. Grammar is a small curated set of high-precision
 * local pattern rules — it catches common mistakes, it is not a full
 * grammar engine, and every grammar suggestion carries its explanation.
 *
 * Words the user adds go to settings.customDictionary, so they persist.
 * The checker runs on plain text; Markdown code spans and fenced blocks
 * are masked out (code is not prose), and HTML notes are checked through
 * their text nodes with an offset map so replacements land in text only.
 */

export type SpellingIssueType = 'spelling' | 'grammar';

export interface SpellingIssue {
  type: SpellingIssueType;
  /** Offset range in the plain text being checked. */
  start: number;
  end: number;
  /** The word or phrase as it appears in the note. */
  text: string;
  /** Replacements in preference order. Empty for spelling with no suggestion. */
  suggestions: string[];
  /** Grammar only: why this was flagged. */
  explanation?: string;
  /** Grammar only: rule id, for "ignore all like this". */
  rule?: string;
}

interface Token {
  text: string;
  start: number;
  end: number;
}

const WORD_PATTERN = /[A-Za-z]+(?:'[A-Za-z]+)*/g;

type SpellChecker = {
  correct(word: string): boolean;
  suggest(word: string): string[];
};

let spellPromise: Promise<SpellChecker> | null = null;

async function loadSpellChecker(): Promise<SpellChecker> {
  if (!spellPromise) {
    spellPromise = (async () => {
      const [{ default: createSpell }, aff, dic] = await Promise.all([
        import('nspell'),
        import('./spelling-data/index.aff?raw'),
        import('./spelling-data/index.dic?raw'),
      ]);
      return createSpell(aff.default, dic.default);
    })();
  }
  return spellPromise;
}

export async function isWordCorrect(word: string): Promise<boolean> {
  const spell = await loadSpellChecker();
  return spell.correct(word);
}

/**
 * nspell's suggestions miss plain transpositions ("teh" never suggests
 * "the"), so also generate every single-edit variant and keep the ones
 * that are real words. Transpositions rank first — they are the most
 * common typo — then nspell's own suggestions by edit distance.
 */
export async function suggestWords(word: string, limit = 8): Promise<string[]> {
  const spell = await loadSpellChecker();
  const lower = word.toLowerCase();
  const ranked: Array<{ suggestion: string; rank: number; index: number }> = [];
  const seen = new Set<string>();
  const push = (suggestion: string, rank: number) => {
    const key = suggestion.toLowerCase();
    if (seen.has(key) || key === lower) return;
    seen.add(key);
    ranked.push({ suggestion: key, rank, index: ranked.length });
  };
  for (let i = 0; i < lower.length - 1; i += 1) {
    push(lower.slice(0, i) + lower[i + 1] + lower[i] + lower.slice(i + 2), 0);
  }
  const alphabet = 'abcdefghijklmnopqrstuvwxyz';
  for (let i = 0; i < lower.length; i += 1) {
    for (const letter of alphabet) {
      push(lower.slice(0, i) + letter + lower.slice(i + 1), 1);
    }
  }
  for (let i = 0; i <= lower.length; i += 1) {
    for (const letter of alphabet) {
      push(lower.slice(0, i) + letter + lower.slice(i), 2);
    }
  }
  for (let i = 0; i < lower.length; i += 1) {
    push(lower.slice(0, i) + lower.slice(i + 1), 3);
  }
  const valid = ranked.filter((entry) => spell.correct(entry.suggestion));
  for (const suggestion of spell.suggest(word)) {
    const key = suggestion.toLowerCase();
    if (seen.has(key) || key === lower) continue;
    seen.add(key);
    valid.push({
      suggestion: key,
      rank: 4,
      index: valid.length,
    });
  }
  valid.sort((a, b) => a.rank - b.rank || a.index - b.index);
  const titled = word[0] === word[0]?.toUpperCase() && word.slice(1) === word.slice(1).toLowerCase();
  return valid.slice(0, limit).map((entry) =>
    titled ? entry.suggestion[0].toUpperCase() + entry.suggestion.slice(1) : entry.suggestion,
  );
}

/** Mask Markdown code so it is never spell-checked, preserving offsets. */
export function maskMarkdownCode(text: string): string {
  const masked = text.split('');
  const mask = (start: number, end: number) => {
    for (let i = start; i < end; i += 1) {
      if (masked[i] !== '\n') masked[i] = ' ';
    }
  };
  for (const match of text.matchAll(/```[\s\S]*?(?:```|$)/g)) {
    mask(match.index ?? 0, (match.index ?? 0) + match[0].length);
  }
  for (const match of text.matchAll(/`[^`\n]+`/g)) {
    mask(match.index ?? 0, (match.index ?? 0) + match[0].length);
  }
  return masked.join('');
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  for (const match of text.matchAll(WORD_PATTERN)) {
    tokens.push({ text: match[0], start: match.index ?? 0, end: (match.index ?? 0) + match[0].length });
  }
  return tokens;
}

function isAcronym(token: string): boolean {
  return token.length > 1 && token === token.toUpperCase();
}

const SILENT_H = new Set(['hour', 'hours', 'honest', 'honestly', 'honesty', 'honor', 'honors', 'honored', 'honour', 'honours', 'heir', 'herb']);
const YOO_U = new Set([
  'university', 'uniform', 'union', 'unique', 'user', 'usual', 'unit', 'united', 'useful', 'useless',
  'utensil', 'utility', 'utopia', 'eulogy', 'euphemism', 'european', 'ewe', 'unicorn', 'unilateral',
]);

const APOSTROPHE_FIXES: Record<string, string> = {
  dont: "don't", cant: "can't", wont: "won't", isnt: "isn't", arent: "aren't",
  wasnt: "wasn't", werent: "weren't", didnt: "didn't", doesnt: "doesn't",
  couldnt: "couldn't", shouldnt: "shouldn't", wouldnt: "wouldn't",
  havent: "haven't", hasnt: "hasn't", hadnt: "hadn't",
  im: "I'm", ive: "I've", ill: "I'll", id: "I'd",
  youre: "you're", youll: "you'll", youve: "you've", youd: "you'd",
  theyre: "they're", theyll: "they'll", theyve: "they've", theyd: "they'd",
  weve: "we've", well: "we'll", wed: "we'd", hes: "he's", shes: "she's",
};

function grammarIssues(text: string, tokens: Token[]): SpellingIssue[] {
  const issues: SpellingIssue[] = [];
  const betweenIsWhitespace = (a: Token, b: Token) => /^\s*$/.test(text.slice(a.end, b.start));
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    const lower = token.text.toLowerCase();
    const previous = tokens[i - 1];
    if (previous && previous.text.toLowerCase() === lower && betweenIsWhitespace(previous, token)) {
      issues.push({
        type: 'grammar',
        start: previous.start,
        end: token.end,
        text: text.slice(previous.start, token.end),
        suggestions: [previous.text],
        explanation: 'The same word appears twice in a row.',
        rule: 'repeated-word',
      });
      continue;
    }
    const next = tokens[i + 1];
    if (lower === 'a' || lower === 'an') {
      if (next) {
        const nextLower = next.text.toLowerCase();
        const startsVowel = /^[aeiou]/.test(nextLower);
        const needsAn = SILENT_H.has(nextLower) || (startsVowel && !YOO_U.has(nextLower));
        const needsA = !startsVowel || YOO_U.has(nextLower);
        if (lower === 'a' && needsAn) {
          issues.push({
            type: 'grammar', start: token.start, end: token.end, text: token.text,
            suggestions: ['an'], explanation: `"An" is used before a vowel sound, as in "an ${next.text}".`, rule: 'a-an',
          });
        } else if (lower === 'an' && needsA && !SILENT_H.has(nextLower)) {
          issues.push({
            type: 'grammar', start: token.start, end: token.end, text: token.text,
            suggestions: ['a'], explanation: `"A" is used before a consonant sound, as in "a ${next.text}".`, rule: 'a-an',
          });
        }
      }
    }
    if (['could', 'should', 'would', 'must'].includes(lower) && next?.text.toLowerCase() === 'of') {
      issues.push({
        type: 'grammar', start: next.start, end: next.end, text: next.text,
        suggestions: ['have'], explanation: `"${token.text} of" is a mishearing of "${token.text} have".`, rule: 'could-of',
      });
    }
    if (token.text === 'i') {
      issues.push({
        type: 'grammar', start: token.start, end: token.end, text: token.text,
        suggestions: ['I'], explanation: 'The pronoun "I" is always capitalized.', rule: 'capital-i',
      });
    }
    if (lower === 'its' && next) {
      const nextLower = next.text.toLowerCase();
      if (['is', 'are', 'was', 'were'].includes(nextLower) || /ing$/.test(nextLower)) {
        issues.push({
          type: 'grammar', start: token.start, end: token.end, text: token.text,
          suggestions: ["it's"], explanation: `"It's" means "it is"; "its" shows possession, as in "its cover".`, rule: 'its-its',
        });
      }
    }
    if (lower === 'alot') {
      issues.push({
        type: 'grammar', start: token.start, end: token.end, text: token.text,
        suggestions: ['a lot'], explanation: '"Alot" is not a word; the phrase is "a lot".', rule: 'alot',
      });
    }
    const fix = APOSTROPHE_FIXES[lower];
    if (fix && token.text === lower) {
      issues.push({
        type: 'grammar', start: token.start, end: token.end, text: token.text,
        suggestions: [fix], explanation: `This contraction needs an apostrophe: "${fix}".`, rule: 'apostrophe',
      });
    }
  }
  return issues;
}

/**
 * Find spelling and grammar issues in plain text, in document order.
 * Spelling needs the dictionary (async); grammar is synchronous patterns
 * applied to the same tokens. Custom words and acronyms are skipped.
 */
export async function findIssues(
  text: string,
  customWords: Iterable<string> = [],
  maskCode = false,
): Promise<SpellingIssue[]> {
  const spell = await loadSpellChecker();
  const custom = new Set([...customWords].map((word) => word.toLowerCase()));
  const searchable = maskCode ? maskMarkdownCode(text) : text;
  const tokens = tokenize(searchable);
  const grammar = grammarIssues(text, tokens);
  const grammarRanges = new Set(grammar.map((issue) => `${issue.start}:${issue.end}`));
  const issues: SpellingIssue[] = [];
  for (const token of tokens) {
    if (isAcronym(token.text)) continue;
    if (custom.has(token.text.toLowerCase())) continue;
    if (grammarRanges.has(`${token.start}:${token.end}`)) continue;
    const word = token.text;
    if (!spell.correct(word)) {
      issues.push({
        type: 'spelling',
        start: token.start,
        end: token.end,
        text: word,
        suggestions: await suggestWords(word),
      });
    }
  }
  return [...issues, ...grammar].sort((a, b) => a.start - b.start);
}

/** The sentence containing an offset, for context display. */
export function sentenceAround(text: string, start: number, end: number): string {
  const before = text.slice(0, start);
  const after = text.slice(end);
  // A missing separator is -1, which must not outrank the start of the text.
  const afterSeparator = (separator: string, skip: number) => {
    const index = before.lastIndexOf(separator);
    return index >= 0 ? index + skip : 0;
  };
  const sentenceStart = Math.max(
    afterSeparator('. ', 2),
    afterSeparator('! ', 2),
    afterSeparator('? ', 2),
    afterSeparator('\n', 1),
    0,
  );
  const sentenceEnd = (() => {
    const match = /^[^\n.!?]*[.!?]?/.exec(after);
    return end + (match?.[0].length ?? 0);
  })();
  return text.slice(sentenceStart, sentenceEnd).replace(/\s+/g, ' ').trim();
}

export interface HtmlTextMap {
  text: string;
  nodes: Array<{ node: Text; start: number; end: number }>;
  doc: Document;
}

/** Plain text plus the text nodes it came from, so a fix lands in text only. */
export function htmlTextMap(html: string): HtmlTextMap {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const nodes: HtmlTextMap['nodes'] = [];
  let text = '';
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode() as Text | null;
  while (node) {
    const start = text.length;
    text += node.data;
    nodes.push({ node, start, end: text.length });
    node = walker.nextNode() as Text | null;
  }
  return { text, nodes, doc };
}

/** Replace a plain-text range in an HTML map; null when it spans nodes. */
export function applyHtmlReplacement(map: HtmlTextMap, start: number, end: number, replacement: string): string | null {
  const holders = map.nodes.filter((entry) => entry.start < end && entry.end > start);
  if (holders.length !== 1) return null;
  const holder = holders[0];
  holder.node.replaceData(start - holder.start, end - start, replacement);
  return map.doc.body.innerHTML;
}
