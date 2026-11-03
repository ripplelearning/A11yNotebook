import type { DictionaryMeaning } from '../../src/shared/thesaurus';

/**
 * Definitions for Thesaurus Lookup, from the free Dictionary API
 * (dictionaryapi.dev, no key required). Ask-only, like citation
 * lookup: the renderer calls this only when the user presses a
 * Lookup button, and only the word itself is sent — never note
 * content. Errors are plain sentences, never transport internals.
 */
export async function fetchDictionaryDefinitions(word: string): Promise<DictionaryMeaning[]> {
  const trimmed = word.trim();
  if (!trimmed) throw new Error('Enter a word to look up.');
  let response: Response;
  try {
    response = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(trimmed)}`);
  } catch {
    throw new Error('Could not reach the dictionary. Check your connection and try again.');
  }
  if (response.status === 404) throw new Error(`No definitions found for “${trimmed}”.`);
  if (!response.ok) throw new Error('The dictionary lookup failed. Try again.');
  const entries = (await response.json()) as {
    meanings?: { partOfSpeech?: string; definitions?: { definition?: string; example?: string }[] }[];
  }[];
  const meanings: DictionaryMeaning[] = [];
  for (const entry of entries ?? []) {
    for (const meaning of entry.meanings ?? []) {
      const definitions = (meaning.definitions ?? [])
        .filter((item) => typeof item.definition === 'string' && item.definition.trim())
        .slice(0, 3)
        .map((item) => ({
          definition: item.definition as string,
          ...(typeof item.example === 'string' && item.example.trim() ? { example: item.example } : {}),
        }));
      if (definitions.length > 0) {
        meanings.push({ partOfSpeech: meaning.partOfSpeech ?? 'General', definitions });
      }
    }
  }
  if (meanings.length === 0) throw new Error(`No definitions found for “${trimmed}”.`);
  return meanings;
}
