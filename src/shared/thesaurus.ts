/**
 * Thesaurus types. The lookup itself runs in the main process (the word
 * list lives on disk there) and is reached through the bridge. The data
 * has synonyms only — no antonyms — grouped by part of speech, as in
 * Word's thesaurus.
 */

export interface ThesaurusGroup {
  partOfSpeech: string;
  synonyms: string[];
}

/** One dictionary meaning: a part of speech with its definitions. */
export interface DictionaryMeaning {
  partOfSpeech: string;
  definitions: { definition: string; example?: string }[];
}
