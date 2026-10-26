import { useEffect, useState } from 'react';
import Modal from '../../components/Modal';
import type { ThesaurusGroup } from '../../../shared/thesaurus';
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

/**
 * Word-style thesaurus. Results are synonyms grouped by part of speech.
 * The bundled data has no antonyms, and the dialog says so rather than
 * inventing them. Everything runs on the device.
 */
export default function ThesaurusDialog({ initialWord, canReplace, onReplace, onClose }: ThesaurusDialogProps) {
  const [query, setQuery] = useState(initialWord);
  const [groups, setGroups] = useState<ThesaurusGroup[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [didYouMean, setDidYouMean] = useState<string[]>([]);
  const [status, setStatus] = useState('');

  const search = async (word: string) => {
    const trimmed = word.trim();
    if (!trimmed) return;
    setLoading(true);
    setStatus('');
    setDidYouMean([]);
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
          {groups.map((group) => (
            <section key={group.partOfSpeech} aria-labelledby={`thesaurus-${group.partOfSpeech}`}>
              <h3 id={`thesaurus-${group.partOfSpeech}`}>{group.partOfSpeech}</h3>
              <ul>
                {group.synonyms.map((synonym) => (
                  <li key={synonym}>
                    {synonym}{' '}
                    <button
                      type="button"
                      onClick={() => {
                        setQuery(synonym);
                        void search(synonym);
                      }}
                    >
                      Look up
                    </button>
                    {canReplace ? (
                      <button
                        type="button"
                        onClick={() => {
                          setStatus(`Replaced with “${synonym}”.`);
                          onReplace(synonym);
                        }}
                      >
                        Replace with this word
                      </button>
                    ) : null}
                  </li>
                ))}
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
