import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import Modal from '../../components/Modal';
import {
  applyTextEdit,
  formatText,
  insertionEdit,
  markdownLink,
  markdownTable,
  wikiLink,
  type FormatAction,
  type TextEdit,
} from './formatting';

export interface EditorToolsProps {
  textareaRef: RefObject<HTMLTextAreaElement>;
  /** Synchronize the controlled textarea value. Called once per tool edit, in addition to native input events. */
  onContentChange?: (content: string) => void;
  announce: (message: string) => void;
  notePaths: string[];
  /** Disable local defaults when the host owns configurable/global shortcuts. */
  bindShortcuts?: boolean;
  /** The host owns file picking/copying and may insert the resulting reference with applyTextEdit. */
  onRequestAttachment?: () => void;
}

export interface EditorToolsHandle {
  format: (action: FormatAction) => void;
  openLink: () => void;
  openTable: () => void;
}

const FORMATS: { action: FormatAction; label: string; shortcut?: string }[] = [
  { action: 'bold', label: 'Bold', shortcut: 'Control+B Meta+B' },
  { action: 'italic', label: 'Italic', shortcut: 'Control+I Meta+I' },
  { action: 'heading1', label: 'Heading 1' },
  { action: 'heading2', label: 'Heading 2' },
  { action: 'heading3', label: 'Heading 3' },
  { action: 'bullet', label: 'Bulleted list', shortcut: 'Control+Shift+8 Meta+Shift+8' },
  { action: 'numbered', label: 'Numbered list', shortcut: 'Control+Shift+7 Meta+Shift+7' },
  { action: 'checkbox', label: 'Checkbox list', shortcut: 'Control+Shift+9 Meta+Shift+9' },
  { action: 'quote', label: 'Quote' },
  { action: 'code', label: 'Code block' },
];

interface SavedSelection {
  textarea: HTMLTextAreaElement;
  content: string;
  start: number;
  end: number;
}

const EditorTools = forwardRef<EditorToolsHandle, EditorToolsProps>(function EditorTools(
  { textareaRef, onContentChange, announce, notePaths, onRequestAttachment, bindShortcuts = true },
  ref,
) {
  const id = useId();
  const toolbarRef = useRef<HTMLDivElement>(null);
  const savedSelection = useRef<SavedSelection | null>(null);
  const [activeButton, setActiveButton] = useState(0);
  const [dialog, setDialog] = useState<'link' | 'table' | null>(null);
  const [linkKind, setLinkKind] = useState('url');
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const [notePath, setNotePath] = useState('');
  const [rows, setRows] = useState('3');
  const [columns, setColumns] = useState('2');
  const [error, setError] = useState('');

  function editableTextarea() {
    const textarea = textareaRef.current;
    return textarea && !textarea.readOnly && !textarea.disabled ? textarea : null;
  }

  function apply(edit: TextEdit, message: string) {
    const textarea = editableTextarea();
    if (!textarea) return;
    applyTextEdit(textarea, edit, onContentChange);
    announce(message);
  }

  function format(action: FormatAction) {
    const textarea = editableTextarea();
    if (!textarea || dialog) return;
    apply(
      formatText(textarea.value, textarea.selectionStart, textarea.selectionEnd, action),
      `${FORMATS.find((item) => item.action === action)?.label} applied.`,
    );
  }

  function openDialog(kind: 'link' | 'table') {
    const textarea = editableTextarea();
    if (!textarea || dialog) return;
    savedSelection.current = {
      textarea,
      content: textarea.value,
      start: textarea.selectionStart,
      end: textarea.selectionEnd,
    };
    setLabel(textarea.value.slice(textarea.selectionStart, textarea.selectionEnd));
    setUrl('');
    setLinkKind('url');
    setNotePath(notePaths[0] ?? '');
    setError('');
    setDialog(kind);
  }

  useImperativeHandle(ref, () => ({
    format,
    openLink: () => openDialog('link'),
    openTable: () => openDialog('table'),
  }));

  // Bind only to the host's native editor, never the window/global command registry.
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea || !bindShortcuts) return;
    const keydown = (event: globalThis.KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.altKey ||
        !(event.ctrlKey || event.metaKey) ||
        dialog ||
        textarea.readOnly ||
        textarea.disabled
      )
        return;
      const key = event.key.toLowerCase();
      let action: FormatAction | undefined;
      if (!event.shiftKey) action = key === 'b' ? 'bold' : key === 'i' ? 'italic' : undefined;
      else
        action =
          event.code === 'Digit7' || key === '7' || key === '&'
            ? 'numbered'
            : event.code === 'Digit8' || key === '8' || key === '*'
              ? 'bullet'
              : event.code === 'Digit9' || key === '9' || key === '('
                ? 'checkbox'
                : undefined;
      if (!action && !(key === 'l' && event.shiftKey)) return;
      event.preventDefault();
      event.stopPropagation();
      if (action) format(action);
      else openDialog('link');
    };
    textarea.addEventListener('keydown', keydown);
    return () => textarea.removeEventListener('keydown', keydown);
  });

  function toolbarKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const buttons = Array.from(toolbarRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? buttons.length - 1
          : event.key === 'ArrowRight'
            ? (index + 1) % buttons.length
            : event.key === 'ArrowLeft'
              ? (index - 1 + buttons.length) % buttons.length
              : -1;
    if (next < 0) return;
    event.preventDefault();
    setActiveButton(next);
    buttons[next].focus();
  }

  function insertFromDialog() {
    const saved = savedSelection.current;
    const textarea = editableTextarea();
    if (!saved || textarea !== saved.textarea || textarea.value !== saved.content) {
      setError('The note changed while the dialog was open. Cancel and try again.');
      return;
    }
    try {
      let text =
        dialog === 'link'
          ? linkKind === 'url'
            ? markdownLink(label, url)
            : wikiLink(notePath, label)
          : markdownTable(Number(rows), Number(columns));
      if (dialog === 'table') {
        if (saved.start > 0 && textarea.value[saved.start - 1] !== '\n') text = `\n${text}`;
        if (saved.end < textarea.value.length && textarea.value[saved.end] !== '\n') text += '\n';
      }
      const edit = insertionEdit(saved.start, saved.end, text);
      // Wait until Modal releases its focus trap before returning focus to the editor.
      setDialog(null);
      requestAnimationFrame(() => {
        if (textareaRef.current !== saved.textarea || saved.textarea.value !== saved.content) return;
        apply(edit, dialog === 'link' ? 'Link inserted.' : 'Table inserted.');
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to insert Markdown.');
    }
  }

  return (
    <>
      <div ref={toolbarRef} role="toolbar" aria-label="Markdown formatting" onKeyDown={toolbarKeyDown}>
        {FORMATS.map((item, index) => (
          <button
            key={item.action}
            type="button"
            tabIndex={activeButton === index ? 0 : -1}
            aria-keyshortcuts={bindShortcuts ? item.shortcut : undefined}
            onFocus={() => setActiveButton(index)}
            onClick={() => format(item.action)}
          >
            {item.label}
          </button>
        ))}
        <button
          type="button"
          tabIndex={activeButton === FORMATS.length ? 0 : -1}
          onFocus={() => setActiveButton(FORMATS.length)}
          aria-keyshortcuts={bindShortcuts ? 'Control+Shift+L Meta+Shift+L' : undefined}
          onClick={() => openDialog('link')}
        >
          Insert link
        </button>
        <button
          type="button"
          tabIndex={activeButton === FORMATS.length + 1 ? 0 : -1}
          onFocus={() => setActiveButton(FORMATS.length + 1)}
          onClick={() => openDialog('table')}
        >
          Insert table
        </button>
        {onRequestAttachment && (
          <button
            type="button"
            tabIndex={activeButton === FORMATS.length + 2 ? 0 : -1}
            onFocus={() => setActiveButton(FORMATS.length + 2)}
            onClick={onRequestAttachment}
          >
            Insert attachment
          </button>
        )}
      </div>
      {dialog && (
        <Modal
          titleId={`${id}-title`}
          title={dialog === 'link' ? 'Insert link' : 'Insert table'}
          onClose={() => setDialog(null)}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              insertFromDialog();
            }}
          >
            <div className="modal-body">
              {dialog === 'link' ? (
                <>
                  <label htmlFor={`${id}-kind`}>Link type</label>
                  <select id={`${id}-kind`} value={linkKind} onChange={(event) => setLinkKind(event.target.value)}>
                    <option value="url">Web or email link</option>
                    <option value="note">Note (wiki link)</option>
                  </select>
                  <label htmlFor={`${id}-label`}>Link text</label>
                  <input id={`${id}-label`} value={label} onChange={(event) => setLabel(event.target.value)} />
                  {linkKind === 'url' ? (
                    <>
                      <label htmlFor={`${id}-url`}>URL</label>
                      <input
                        id={`${id}-url`}
                        data-autofocus
                        type="text"
                        value={url}
                        aria-describedby={`${id}-hint`}
                        onChange={(event) => setUrl(event.target.value)}
                      />
                      <p id={`${id}-hint`}>Use an https, http, or mailto URL.</p>
                    </>
                  ) : (
                    <>
                      <label htmlFor={`${id}-note`}>Note</label>
                      <select
                        id={`${id}-note`}
                        value={notePath}
                        onChange={(event) => setNotePath(event.target.value)}
                        disabled={notePaths.length === 0}
                      >
                        {notePaths.length === 0 && <option value="">No notes available</option>}
                        {notePaths.map((path) => (
                          <option key={path} value={path}>
                            {path}
                          </option>
                        ))}
                      </select>
                    </>
                  )}
                </>
              ) : (
                <>
                  <label htmlFor={`${id}-rows`}>Body rows</label>
                  <input
                    id={`${id}-rows`}
                    data-autofocus
                    type="number"
                    min="1"
                    max="50"
                    required
                    value={rows}
                    onChange={(event) => setRows(event.target.value)}
                  />
                  <label htmlFor={`${id}-columns`}>Columns</label>
                  <input
                    id={`${id}-columns`}
                    type="number"
                    min="1"
                    max="20"
                    required
                    value={columns}
                    onChange={(event) => setColumns(event.target.value)}
                  />
                </>
              )}
              {error && <p role="alert">{error}</p>}
            </div>
            <div className="modal-actions">
              <button type="submit" disabled={dialog === 'link' && linkKind === 'note' && notePaths.length === 0}>
                Insert
              </button>
              <button type="button" onClick={() => setDialog(null)}>
                Cancel
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
});

export default EditorTools;
