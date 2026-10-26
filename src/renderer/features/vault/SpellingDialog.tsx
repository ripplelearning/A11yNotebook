import { useEffect, useMemo, useRef, useState } from 'react';
import Modal from '../../components/Modal';
import {
  applyHtmlReplacement,
  findIssues,
  htmlTextMap,
  sentenceAround,
  suggestWords,
  type SpellingIssue,
} from '../../../shared/spelling';

interface SpellingDialogProps {
  /** File name of the note, used only to detect HTML notes. */
  notePath: string;
  /** Current note content. */
  content: string;
  /** Words the user already added to the custom dictionary. */
  customWords: string[];
  /** Called when the dialog closes and the content changed. */
  onApply: (content: string) => void;
  /** Called when the user adds a word to the custom dictionary. */
  onAddToDictionary: (word: string) => void;
  onClose: () => void;
}

interface Snapshot {
  content: string;
  issues: SpellingIssue[];
  index: number;
}

/**
 * Word-style spelling and grammar check. Works on a local copy of the note
 * and applies it once, when the dialog closes. Spelling issues offer
 * suggestions and a free-text replacement; grammar issues explain the rule.
 * Everything runs on the device — nothing is sent anywhere.
 */
export default function SpellingDialog({
  notePath,
  content,
  customWords,
  onApply,
  onAddToDictionary,
  onClose,
}: SpellingDialogProps) {
  const isHtml = notePath.toLowerCase().endsWith('.html') || notePath.toLowerCase().endsWith('.htm');
  const [working, setWorking] = useState(content);
  const [issues, setIssues] = useState<SpellingIssue[] | null>(null);
  const [index, setIndex] = useState(0);
  const [ignoredWords, setIgnoredWords] = useState<Set<string>>(new Set());
  const [ignoredRules, setIgnoredRules] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [customText, setCustomText] = useState('');
  const [history, setHistory] = useState<Snapshot[]>([]);
  const [found, setFound] = useState(0);
  const [changed, setChanged] = useState(0);
  const [ignored, setIgnored] = useState(0);
  const [notice, setNotice] = useState('');
  const customSetRef = useRef<Set<string>>(new Set(customWords.map((word) => word.trim().toLowerCase())));

  const text = useMemo(() => {
    if (!isHtml) return working;
    try {
      return htmlTextMap(working).text;
    } catch {
      return working;
    }
  }, [isHtml, working]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const all = await findIssues(text, customSetRef.current, true);
      if (cancelled) return;
      const kept = all.filter((issue) =>
        issue.type === 'spelling' ? !ignoredWords.has(issue.text.toLowerCase()) : !ignoredRules.has(issue.rule!),
      );
      setIssues(kept);
      setFound(kept.length);
      setIndex(0);
    })();
    return () => {
      cancelled = true;
    };
    // Run once, when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const issue = issues?.[index];
  const [suggestions, setSuggestions] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    setSuggestions([]);
    setSelected(null);
    setCustomText('');
    if (issue?.type === 'spelling') {
      suggestWords(issue.text).then((words) => {
        if (cancelled) return;
        setSuggestions(words);
        setSelected(words[0] ?? null);
      });
    } else if (issue?.suggestions?.length) {
      setSelected(issue.suggestions[0]);
    }
    return () => {
      cancelled = true;
    };
  }, [issue]);

  const close = () => {
    if (working !== content) onApply(working);
    onClose();
  };

  /** Replace the current issue's range in the note, shifting later issues. */
  const applyChange = (replacement: string) => {
    if (!issue || !issues) return;
    const nextText = text.slice(0, issue.start) + replacement + text.slice(issue.end);
    let nextWorking = nextText;
    if (isHtml) {
      const replaced = applyHtmlReplacement(htmlTextMap(working), issue.start, issue.end, replacement);
      if (replaced === null) {
        setNotice('That change could not be applied because the word spans formatted text. It was skipped.');
        removeCurrent();
        setIgnored((count) => count + 1);
        return;
      }
      nextWorking = replaced;
    }
    const shift = replacement.length - (issue.end - issue.start);
    const nextIssues = issues
      .filter((other) => other !== issue && (other.end <= issue.start || other.start >= issue.end))
      .map((other) =>
        other.start >= issue.end ? { ...other, start: other.start + shift, end: other.end + shift } : other,
      );
    setHistory((stack) => [...stack, { content: working, issues, index }]);
    setWorking(nextWorking);
    setIssues(nextIssues);
    setIndex(Math.min(index, Math.max(0, nextIssues.length - 1)));
    setChanged((count) => count + 1);
    setNotice('');
  };

  const removeCurrent = () => {
    if (!issues) return;
    const nextIssues = issues.filter((_, i) => i !== index);
    setIssues(nextIssues);
    setIndex(Math.min(index, Math.max(0, nextIssues.length - 1)));
  };

  const handleIgnoreOnce = () => {
    removeCurrent();
    setIgnored((count) => count + 1);
  };

  const handleIgnoreAll = () => {
    if (!issue || !issues) return;
    if (issue.type === 'spelling') {
      const word = issue.text.toLowerCase();
      setIgnoredWords((set) => new Set(set).add(word));
      setIssues(issues.filter((other) => !(other.type === 'spelling' && other.text.toLowerCase() === word)));
    } else {
      const rule = issue.rule!;
      setIgnoredRules((set) => new Set(set).add(rule));
      setIssues(issues.filter((other) => !(other.type === 'grammar' && other.rule === rule)));
    }
    setIndex(0);
    setIgnored((count) => count + 1);
  };

  const handleChangeAll = () => {
    if (!issue || issue.type !== 'spelling' || !issues) return;
    const replacement = customText.trim() || selected;
    if (!replacement) return;
    const word = issue.text.toLowerCase();
    const matches = issues.filter((other) => other.type === 'spelling' && other.text.toLowerCase() === word);
    let nextWorking = working;
    let nextText = text;
    // Last to first, so earlier offsets stay valid.
    for (const match of [...matches].sort((a, b) => b.start - a.start)) {
      if (isHtml) {
        const replaced = applyHtmlReplacement(htmlTextMap(nextWorking), match.start, match.end, replacement);
        if (replaced === null) continue;
        nextWorking = replaced;
      }
      nextText = nextText.slice(0, match.start) + replacement + nextText.slice(match.end);
    }
    if (!isHtml) nextWorking = nextText;
    setHistory((stack) => [...stack, { content: working, issues, index }]);
    setWorking(nextWorking);
    setIssues(issues.filter((other) => !(other.type === 'spelling' && other.text.toLowerCase() === word)));
    setIndex(0);
    setChanged((count) => count + matches.length);
  };

  const handleAddToDictionary = () => {
    if (!issue || issue.type !== 'spelling' || !issues) return;
    const word = issue.text.toLowerCase();
    customSetRef.current.add(word);
    onAddToDictionary(word);
    setIssues(issues.filter((other) => !(other.type === 'spelling' && other.text.toLowerCase() === word)));
    setIndex(0);
    setIgnored((count) => count + 1);
  };

  const handleUndo = () => {
    const previous = history[history.length - 1];
    if (!previous) return;
    setHistory(history.slice(0, -1));
    setWorking(previous.content);
    setIssues(previous.issues);
    setIndex(previous.index);
    setChanged((count) => Math.max(0, count - 1));
  };

  if (issues === null) {
    return (
      <Modal titleId="spelling-title" title="Spelling and Grammar Check" onClose={close}>
        <p role="status">Checking spelling and grammar…</p>
      </Modal>
    );
  }

  if (issues.length === 0) {
    return (
      <Modal titleId="spelling-title" title="Spelling and Grammar Check" onClose={close}>
        <p role="status">
          Check complete. {found} {found === 1 ? 'issue' : 'issues'} found, {changed} changed, {ignored} ignored.
        </p>
        <button type="button" data-autofocus onClick={close}>
          Close
        </button>
      </Modal>
    );
  }

  if (!issue) return null;
  const replacement = customText.trim() || selected;
  return (
    <Modal titleId="spelling-title" title="Spelling and Grammar Check" onClose={close}>
      <p aria-live="polite">
        Issue {index + 1} of {issues.length}: {issue.type === 'spelling' ? 'Spelling' : 'Grammar'}
      </p>
      <p>
        <strong>{issue.text}</strong>
      </p>
      {issue.type === 'grammar' && issue.explanation ? <p>{issue.explanation}</p> : null}
      <p>
        <label htmlFor="spelling-context">In context</label>
        <textarea id="spelling-context" readOnly value={sentenceAround(text, issue.start, issue.end)} rows={3} />
      </p>
      {suggestions.length > 0 || issue.suggestions?.length ? (
        <fieldset>
          <legend>Suggestions</legend>
          {(issue.type === 'spelling' ? suggestions : issue.suggestions!).map((suggestion) => (
            <label key={suggestion}>
              <input
                type="radio"
                name="spelling-suggestion"
                checked={selected === suggestion}
                onChange={() => setSelected(suggestion)}
              />
              {suggestion}
            </label>
          ))}
        </fieldset>
      ) : (
        <p>No suggestions.</p>
      )}
      <p>
        <label htmlFor="spelling-replace">
          Replace with
          <input
            id="spelling-replace"
            type="text"
            value={customText}
            onChange={(event) => setCustomText(event.target.value)}
            placeholder={selected ?? ''}
          />
        </label>
      </p>
      {notice ? (
        <p role="status">{notice}</p>
      ) : null}
      <div>
        <button type="button" onClick={handleIgnoreOnce}>
          Ignore Once
        </button>
        <button type="button" onClick={handleIgnoreAll}>
          {issue.type === 'spelling' ? 'Ignore All' : 'Ignore Rule'}
        </button>
        {issue.type === 'spelling' ? (
          <>
            <button type="button" onClick={handleAddToDictionary}>
              Add to Dictionary
            </button>
            <button type="button" disabled={!replacement} onClick={() => replacement && applyChange(replacement)}>
              Change
            </button>
            <button type="button" disabled={!replacement} onClick={handleChangeAll}>
              Change All
            </button>
          </>
        ) : (
          <button type="button" disabled={!replacement} onClick={() => replacement && applyChange(replacement)}>
            Change
          </button>
        )}
        <button type="button" disabled={history.length === 0} onClick={handleUndo}>
          Undo
        </button>
        <button type="button" onClick={close}>
          Close
        </button>
      </div>
    </Modal>
  );
}
