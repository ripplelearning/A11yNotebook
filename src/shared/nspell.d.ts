declare module 'nspell' {
  interface NSpell {
    correct(word: string): boolean;
    suggest(word: string): string[];
    add(word: string): void;
  }
  function nspell(aff: string, dic: string): NSpell;
  export default nspell;
}
