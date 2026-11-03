import { useEffect, useState } from 'react';
import Modal from '../../components/Modal';
import type { DictionaryMeaning, ThesaurusGroup } from '../../../shared/thesaurus';
import { suggestWords } from '../../../shared/spelling';

interface ThesaurusDialogProps {
  /** The word selected in the note, or empty if none was selected. */
  initialWord: string;
  /** False in read mode, where there is nothing to replace. */
  canReplace: boolean;
  /** Replace the selected word in the note, then close. */
  onReplace: (replacement: string) => void;
  onClose: () => void;
}

type DefinitionState =
  | { state: 'loading' }
  | { state: 'ready'; meanings: DictionaryMeaning[] }
  | { state: 'error'; message: string };

function slug(value: string): string {
  return value.replace(/[^a-zA-Z0-9]+/g, '-');
}

/**
 * Word-style thesaurus. Results are synonyms grouped by part of speech.
 * The bundled data has no antonyms, and the dialog says so rather than
 * inventing them. Each synonym is itself a button: it replaces the
 * selected word in edit mode, and looks up that synonym's synonyms in
 * read mode. A per-synonym Lookup button shows definitions from a
 * free online dictionary — ask-only, like citation lookup: nothing
 * is sent anywhere until a Lookup button is pressed, and only the
 * word itself is sent.
 */
export default function ThesaurusDialog({ initialWord, canReplace, onReplace, onClose }: ThesaurusDialogProps) {
  const [query, setQuery] = useState(initialWord);
  const [groups, setGroups] = useState<ThesaurusGroup[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [didYouMean, setDidYouMean] = useState<string[]>([]);
  const [status, setStatus] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [definitions, setDefinitions] = useState<Record<string, DefinitionState>>({});

  const search = async (word: string) => {
    const trimmed = word.trim();
    if (!trimmed) return;
    setLoading(true);
    setStatus('');
    setDidYouMean([]);
    setExpanded(new Set());
    setDefinitions({});
    const lookup = window.a11yNotebook?.vault.lookupThesaurus;
    const found = lookup ? await lookup(trimmed) : [];
    setGroups(found);
    if (found.length === 0) {
      setDidYouMean(await suggestWords(trimmed));
    }
    setLoading(false);
  };

  useEffect(() => {
    if (initialWord.trim()) void search(initialWord);
    // Run once, when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    void search(query);
  };

  const toggleDefinitions = async (synonym: string) => {
    if (expanded.has(synonym)) {
      setExpanded((current) => {
        const next = new Set(current);
        next.delete(synonym);
        return next;
      });
      return;
    }
    setExpanded((current) => new Set(current).add(synonym));
    if (definitions[synonym]) return;
    const fetchDefinitions = window.a11yNotebook?.vault.fetchDictionaryDefinitions;
    if (!fetchDefinitions) {
      setDefinitions((current) => ({ ...current, [synonym]: { state: 'error', message: 'Definitions are unavailable right now.' } }));
      return;
    }
    setDefinitions((current) => ({ ...current, [synonym]: { state: 'loading' } }));
    try {
      const meanings = await fetchDefinitions(synonym);
      setDefinitions((current) => ({ ...current, [synonym]: { state: 'ready', meanings } }));
    } catch (reason) {
      setDefinitions((current) => ({
        ...current,
        [synonym]: {
          state: 'error',
          message: reason instanceof Error ? reason.message : 'The dictionary lookup failed. Try again.',
        },
      }));
    }
  };

  return (
    <Modal titleId="thesaurus-title" title="Thesaurus" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <label htmlFor="thesaurus-word">
          Look up
          <input
            id="thesaurus-word"
            type="text"
            data-autofocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <button type="submit">Search</button>
      </form>
      {loading ? <p role="status">Searching…</p> : null}
      {status ? (
        <p role="status">{status}</p>
      ) : null}
      {groups && groups.length === 0 && !loading ? (
        <div>
          <p role="status">No synonyms found for “{query}”.</p>
          {didYouMean.length > 0 ? (
            <div>
              <p>Did you mean:</p>
              {didYouMean.map((word) => (
                <button
                  key={word}
                  type="button"
                  onClick={() => {
                    setQuery(word);
                    void search(word);
                  }}
                >
                  {word}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {groups && groups.length > 0 ? (
        <div>
          <p>Synonyms for “{query}”. This thesaurus has synonyms only, no antonyms.</p>
          <p>
            Each synonym is a button: it replaces the selected word in edit mode, or looks up that synonym in read
            mode. Definitions come from a free online dictionary; nothing is sent anywhere until you press a Lookup
            button, and only the word itself is sent.
          </p>
          {groups.map((group) => (
            <section key={group.partOfSpeech} aria-labelledby={`thesaurus-${group.partOfSpeech}`}>
              <h3 id={`thesaurus-${group.partOfSpeech}`}>{group.partOfSpeech}</h3>
              <ul>
                {group.synonyms.map((synonym) => {
                  const regionId = `thesaurus-def-${slug(group.partOfSpeech)}-${slug(synonym)}`;
                  const isExpanded = expanded.has(synonym);
                  const definition = definitions[synonym];
                  return (
                    <li key={synonym}>
                      <button
                        type="button"
                        onClick={() => {
                          if (canReplace) {
                            setStatus(`Replaced with “${synonym}”.`);
                            onReplace(synonym);
                          } else {
                            setQuery(synonym);
                            void search(synonym);
                          }
                        }}
                      >
                        {synonym}
                      </button>{' '}
                      <button
                        type="button"
                        aria-expanded={isExpanded}
                        aria-controls={regionId}
                        onClick={() => void toggleDefinitions(synonym)}
                      >
                        Lookup {synonym}
                      </button>
                      {isExpanded ? (
                        <div id={regionId}>
                          {definition?.state === 'loading' ? <p role="status">Looking up definitions…</p> : null}
                          {definition?.state === 'error' ? <p role="status">{definition.message}</p> : null}
                          {definition?.state === 'ready' ? (
                            <div>
                              <h4>Definitions for {synonym}</h4>
                              {definition.meanings.map((meaning) => (
                                <div key={meaning.partOfSpeech}>
                                  <h5>{meaning.partOfSpeech}</h5>
                                  <ol>
                                    {meaning.definitions.map((item) => (
                                      <li key={item.definition}>
                                        {item.definition}
                                        {item.example ? <p>Example: {item.example}</p> : null}
                                      </li>
                                    ))}
                                  </ol>
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      ) : null}
      <button type="button" onClick={onClose}>
        Close
      </button>
    </Modal>
  );
}
