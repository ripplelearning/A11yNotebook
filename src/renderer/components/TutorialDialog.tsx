import { useEffect, useRef, useState } from 'react';
import Modal from './Modal';

const TUTORIAL_STORAGE_KEY = 'a11y-notebook.tutorial';

export type TutorialState = {
  suppressed: boolean;
  lastVersionSeen: string;
};

export function readTutorialState(): TutorialState {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(TUTORIAL_STORAGE_KEY) ?? 'null') as Partial<TutorialState> | null;
    return {
      suppressed: parsed?.suppressed === true,
      lastVersionSeen: typeof parsed?.lastVersionSeen === 'string' ? parsed.lastVersionSeen : '',
    };
  } catch {
    return { suppressed: false, lastVersionSeen: '' };
  }
}

export function writeTutorialState(state: TutorialState): void {
  try {
    window.localStorage.setItem(TUTORIAL_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage is best-effort; a failed write only means the tour may show again.
  }
}

const PAGES: { heading: string; body: string[] }[] = [
  {
    heading: 'Welcome to A11y Notebook',
    body: [
      'A11y Notebook is a local-first notebook for notes, files, tasks, and research. Everything works with a keyboard and a screen reader, and your library stays on your own computer.',
      'This short tour covers the basics. Use Next to continue, or Close to skip it at any time.',
    ],
  },
  {
    heading: 'Libraries and notebooks',
    body: [
      'Start by opening or creating a library, a folder on your computer that holds everything. Inside a library, notebooks group related notes.',
      'Use the File menu to open or create a library. The Libraries view lists your libraries and lets you open a different one at any time.',
    ],
  },
  {
    heading: 'Notes and reading',
    body: [
      'Write notes in Markdown or HTML. In Reading view, a note is presented as a structured document with headings, links, images, and tables, so a screen reader navigates it like a web page.',
      'You can also import Word, PDF, ePub, plain text, and web page files.',
    ],
  },
  {
    heading: 'Tasks and calendar',
    body: [
      'Tasks live in notes as checkboxes, and the Tasks view collects them with due dates and priorities. Reminders can notify you when a task is due.',
      'The Calendar view shows appointments in an agenda list or a month grid.',
    ],
  },
  {
    heading: 'Search and shortcuts',
    body: [
      'Press Ctrl+Shift+P for the command palette, F6 and Shift+F6 to move between panes, and Ctrl+Tab to cycle through open tabs.',
      'The Help menu lists every keyboard shortcut, and you can reopen this tutorial from Help at any time.',
    ],
  },
];

export default function TutorialDialog({ onClose }: { onClose: () => void }) {
  const [page, setPage] = useState(0);
  const [suppressed, setSuppressed] = useState(() => readTutorialState().suppressed);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const lastPage = PAGES.length - 1;
  const current = PAGES[page];

  useEffect(() => {
    headingRef.current?.focus();
  }, [page]);

  return (
    <Modal titleId="tutorial-title" title="Getting started with A11y Notebook" onClose={onClose}>
      <h3 ref={headingRef} tabIndex={-1} data-autofocus>
        {current.heading}
      </h3>
      {current.body.map((paragraph) => (
        <p key={paragraph}>{paragraph}</p>
      ))}
      <p>
        Page {page + 1} of {PAGES.length}
      </p>
      <label>
        <input
          type="checkbox"
          checked={suppressed}
          onChange={(event) => {
            const next = event.target.checked;
            setSuppressed(next);
            writeTutorialState({ ...readTutorialState(), suppressed: next });
          }}
        />
        Don&apos;t show this again
      </label>
      <div>
        <button type="button" disabled={page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>
          Previous
        </button>
        {page < lastPage ? (
          <button type="button" onClick={() => setPage((value) => Math.min(lastPage, value + 1))}>
            Next
          </button>
        ) : (
          <button type="button" onClick={onClose}>
            Finish
          </button>
        )}
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}
