import { describe, expect, it } from 'vitest';
import {
  applyHtmlReplacement,
  findIssues,
  htmlTextMap,
  isWordCorrect,
  maskMarkdownCode,
  sentenceAround,
  suggestWords,
} from '../shared/spelling';

describe('spelling and grammar', () => {
  it('accepts real words and rejects nonsense', async () => {
    expect(await isWordCorrect('hello')).toBe(true);
    expect(await isWordCorrect('accessibility')).toBe(true);
    expect(await isWordCorrect('zzzqqq')).toBe(false);
  });

  it('suggests corrections', async () => {
    const suggestions = await suggestWords('teh');
    expect(suggestions).toContain('the');
    expect(await suggestWords('recieve')).toContain('receive');
  });

  it('flags spelling in document order and skips code', async () => {
    const issues = await findIssues('The teh cat sat on teh `teh` mat.\n\n```\nrecieve\n```', [], true);
    expect(issues.map((issue) => issue.text)).toEqual(['teh', 'teh']);
    expect(maskMarkdownCode('a `code` b')).toBe('a        b');
  });

  it('flags repeated words, a/an, could of, lowercase i, its, alot, and missing apostrophes', async () => {
    const issues = await findIssues(
      'The the cat sat. A apple fell. I could of gone, but i stayed. Its going well. That is alot. I dont know.',
    );
    const byRule = new Map(issues.map((issue) => [issue.rule, issue]));
    expect(byRule.get('repeated-word')?.suggestions).toEqual(['The']);
    expect(byRule.get('a-an')?.suggestions).toEqual(['an']);
    expect(byRule.get('could-of')?.suggestions).toEqual(['have']);
    expect(byRule.get('capital-i')?.suggestions).toEqual(['I']);
    expect(byRule.get('its-its')?.suggestions).toEqual(["it's"]);
    expect(byRule.get('alot')?.suggestions).toEqual(['a lot']);
    expect(byRule.get('apostrophe')?.suggestions).toEqual(["don't"]);
  });

  it('finds the sentence around an issue', () => {
    expect(sentenceAround('First sentence. The teh cat sat. Last one.', 20, 23)).toBe('The teh cat sat.');
  });

  it('replaces a word inside HTML text nodes only', () => {
    const map = htmlTextMap('<p title="teh">The teh cat</p>');
    const replaced = applyHtmlReplacement(map, 4, 7, 'the');
    expect(replaced).toBe('<p title="teh">The the cat</p>');
  });
});
