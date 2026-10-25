/**
 * Thesaurus lookup in the main process, where the bundled word list can be
 * read from disk. The list (word-thesaurus data, BSD-licensed) is loaded
 * once on first lookup — about two seconds — and then cached; later
 * lookups are instant. Entries are grouped by part of speech. The data
 * has synonyms only, no antonyms.
 */
import { find, load, posName } from 'word-thesaurus';
import type { ThesaurusGroup } from '../../src/shared/thesaurus';

let loaded = false;

function ensureLoaded(): void {
  if (!loaded) {
    load();
    loaded = true;
  }
}

export function lookupThesaurus(word: string): ThesaurusGroup[] {
  const key = word.trim().toLowerCase();
  if (!key) return [];
  ensureLoaded();
  const groups: ThesaurusGroup[] = [];
  for (const entry of find(key)) {
    const synonyms = entry.raw
      .map((synonym) => synonym.trim())
      .filter((synonym) => synonym && synonym.toLowerCase() !== key);
    if (synonyms.length > 0) {
      groups.push({ partOfSpeech: posName(entry.pos), synonyms });
    }
  }
  return groups;
}
