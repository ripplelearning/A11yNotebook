import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from 'react';
import {
  COMMANDS,
  cycleFocusRegions,
  defaultShortcut,
  dispatchCommand,
  effectiveCommandShortcuts,
  FOCUS_REGION_ORDER,
  getCommandById,
  getContextMenuCommands,
  matchesShortcut,
  toAriaKeyShortcut,
  toMacAriaKeyShortcut,
  type CommandId,
  type MenuContext,
} from '../shared/command-registry';
import {
  emptyNavigationHistory,
  goBack as historyGoBack,
  goForward as historyGoForward,
  recordLocation as recordHistoryLocation,
  type NavigationHistoryState,
  type NavigationLocation,
} from '../shared/navigation-history';
import { isMenuCommand, type NativeMenuState } from '../shared/ipc';
import type {
  AppMode,
  FocusRegion,
  FocusTarget,
  BookmarkAnchor,
  RecentLibrary,
  VaultBookmark,
  VaultEntry,
  VaultInfo,
  VaultLink,
  VaultTask,
} from '../shared/types';
import CommandPalette from './components/CommandPalette';
import NoteMetadataDialog from './components/NoteMetadataDialog';
import GlobalContextMenu from './components/GlobalContextMenu';
import { AboutDialog, FeedbackDialog, KeyboardShortcutsDialog } from './components/HelpDialogs';
import TutorialDialog, { readTutorialState, writeTutorialState } from './components/TutorialDialog';
import FindDialog, { type FindMatchJump } from './components/FindDialog';
import { findGridFocusTarget } from './grid-focus';
import UpdateDialog from './components/UpdateDialog';
import MarkdownDocument from './features/vault/MarkdownDocument';
import { sanitizeNoteHtml } from './features/vault/sanitize-html';
import { outlineConversionWarning } from '../shared/outline-conversion';
import {
  headingAnchorAt,
  headingTextSpan,
  lineSpanAt,
  normalizeHeadingText,
  readingJumpHeading,
  resolveBookmarkAnchor,
  surroundingText,
} from '../shared/bookmark-anchors';
import { findAllMatches, findMatchSnippets, matchSnippet } from '../shared/find-text';
import {
  findDomMatches,
  focusReaderSearchBox,
  selectDomMatch,
  selectElementContents,
  selectRenderedLine,
} from '../shared/find-dom';
import { updateMarkdownTaskLine } from '../shared/task-line';
import {
  createEditHistory,
  recordEdit,
  redoEdit,
  undoEdit,
  type EditHistory,
  type EditSnapshot,
} from '../shared/edit-history';
import {
  completeTimelineRedo,
  completeTimelineUndo,
  createUndoTimeline,
  purgeTimelineNote,
  recordTimelineAction,
  restoreTimelineRedo,
  restoreTimelineUndo,
  takeTimelineRedo,
  takeTimelineUndo,
} from '../shared/undo-timeline';
import { convertNoteContent, formatConversionWarning } from './features/vault/format-conversion';
import OrganizeLibraryDialog from './features/vault/OrganizeLibraryDialog';
import ItemPropertiesDialog from './features/vault/ItemPropertiesDialog';
import ProtectedItemDialog, { type ProtectedAction } from './features/vault/ProtectedItemDialog';
import {
  findEntryInTree,
  findProtectionBlockInTree,
  remapPathAfterOps,
  type StagedOp,
} from './features/vault/organize-library';
import { useUpdater } from './hooks/useUpdater';
import type { OpenNote } from './features/vault/open-note';
import { useVaultChanges } from './hooks/useVaultChanges';
import ConflictDialog from './features/vault/ConflictDialog';
import DeleteLibraryDialog from './features/screens/DeleteLibraryDialog';
import DeleteGuardDialog from './features/vault/DeleteGuardDialog';
import ItemDialog, { type ItemDialogRequest } from './features/vault/ItemDialog';
import BookmarkNameDialog, { type BookmarkNameRequest } from './features/vault/BookmarkNameDialog';
import SearchResults, { type SearchScope } from './features/search/SearchResults';
import type { VaultSearchQuery, VaultSearchResult } from '../shared/search';
import { searchTasksRemindersAppointments } from '../shared/search';
import SettingsDialog from './features/settings/SettingsDialog';
import SpellingDialog from './features/vault/SpellingDialog';
import ThesaurusDialog from './features/vault/ThesaurusDialog';
import { BrokenLinksDialog } from './features/vault/BrokenLinksDialog';
import { retargetLinkContent } from '../shared/link-retarget';
import { notePositionFromHeadings } from '../shared/note-reading-position';
import LockedReminderAlerts from './features/reminders/LockedReminderAlerts';
import ReminderAlerts from './features/reminders/ReminderAlerts';
import type { Reminder } from '../shared/reminders';
import { formatTaskDueDate } from '../shared/reminders';
import {
  DEFAULT_SETTINGS,
  formatPriorityName,
  resolvePriorityOptions,
  settingsLoadStatusMessage,
  type NotebookSettings,
} from '../shared/settings';
import AttachmentView from './features/previews/AttachmentView';
import type { AttachmentPreview } from '../shared/attachments';
import { AudioRecorder, type FinishedRecording } from './features/audio/recorder';
import { LocalTranscriber } from './features/audio/transcription';
import { TranscriptionModelDialog } from './features/audio/TranscriptionModelDialog';
import { saveRecording } from './features/audio/save-recording';
import {
  audioMimeType,
  isAudioPath,
  transcriptNoteContent,
  transcriptPathForAudio,
  type TranscriptionModelOption,
} from '../shared/audio';
import { isAllowedLinkUrl, parseLinkUrl } from '../shared/links';
import EditorTools, { type EditorToolsHandle } from './features/editor/EditorTools';
import NewFromTemplateDialog from './features/templates/NewFromTemplateDialog';
import type { NoteTemplate } from '../shared/templates';
import { useAnnotations } from './features/annotations/useAnnotations';
import type { NoteAnnotation } from '../shared/annotations';
import RemindersView from './features/reminders/RemindersView';
import CalendarScreen from './features/calendar/CalendarScreen';
import TaskProgressSummaries from './features/reminders/TaskProgressSummaries';
import NewTaskDialog, { AssociatedTaskDialog } from './features/reminders/NewTaskDialog';
import { QuickTaskDialog, QuickTaskLibraryPicker } from './features/reminders/QuickTaskDialog';
import { LinkDialog } from './features/links/LinkDialog';
import TaskScheduleDialog, { type TaskSchedule } from './features/reminders/TaskScheduleDialog';
import CitationDialog from './features/vault/CitationDialog';
import {
  formatBibliographyBlock,
  type BibliographyEntry,
  type CitationStyle,
} from '../shared/citations';
import {
  buildFootnote,
  footnoteEditorHtml,
  insertFootnoteAtCaret,
} from '../shared/footnotes';
import TaskPriorityDialog from './features/reminders/TaskPriorityDialog';
import TaskLinkDialog from './features/reminders/TaskLinkDialog';
import type { TaskLink, TaskLinkKind } from '../shared/task-links';
import { dropLinksToMissingTargets, reconcileTaskAutoLinks } from '../shared/task-links';
import PasteLibraryDialog, { type PasteLibraryChoice } from './features/vault/PasteLibraryDialog';
import PasteOrphanDialog, { type PasteOrphanResult } from './features/vault/PasteOrphanDialog';
import { useReminders } from './hooks/useReminders';
import AssetsWorkspace from './features/assets/AssetsWorkspace';
import { assetTypes, createAssetRegistry } from '../shared/assets';
import InsertAttachmentDialog from './features/editor/InsertAttachmentDialog';
import Modal from './components/Modal';
import SecurityGate from './features/security/SecurityGate';
import NotePasswordDialog from './features/security/NotePasswordDialog';
import WebCaptureDialog from './features/previews/WebCaptureDialog';
import ExportNoteDialog from './features/vault/ExportNoteDialog';
import { usePdfReadingPreferences } from './hooks/usePdfReadingPreferences';
import ContentsScreen from './features/screens/ContentsScreen';
import LibrariesScreen from './features/screens/LibrariesScreen';
import NotebooksScreen from './features/screens/NotebooksScreen';
import NotesFilesScreen from './features/screens/NotesFilesScreen';
import ExternalFileDialog from './features/vault/ExternalFileDialog';
import { isInternallySupportedPath } from '../shared/file-provenance';
import { filterHiddenOriginals, supersededPaths } from '../shared/library-views';

type DialogId =
  | 'palette'
  | 'updates'
  | 'shortcuts'
  | 'about'
  | 'feedback'
  | 'settings'
  | 'template'
  | 'attachment-insert'
  | 'web-capture'
  | 'note-metadata'
  | 'new-task'
  | 'broken-links';
type TreeAction = 'new-note' | 'new-template' | 'rename' | 'move' | 'delete' | 'reveal' | 'external' | 'bookmark';

interface ContextMenuRequest {
  context: MenuContext;
  invoker: HTMLElement;
  x: number;
  y: number;
  path?: string;
  href?: string;
  tabId?: string;
  selection?: string;
  selectionStart?: number;
  selectionEnd?: number;
  selectionRange?: Range;
}

function flattenEntries(entries: VaultEntry[]): VaultEntry[] {
  return entries.flatMap((entry) => [entry, ...flattenEntries(entry.children ?? [])]);
}

function findEntry(entries: VaultEntry[], targetPath: string | null): VaultEntry | undefined {
  for (const entry of entries) {
    if (entry.path === targetPath) return entry;
    const nested = entry.children && findEntry(entry.children, targetPath);
    if (nested) return nested;
  }
  return undefined;
}

function isManagedEntry(entry: VaultEntry): boolean {
  // 'task' notes are created by the app, so they stay managed: they can
  // receive further tasks and show as managed entries elsewhere.
  return entry.provenance === 'created' || entry.provenance === 'imported' || entry.provenance === 'task';
}

function notebookForTask(task: VaultTask) {
  return task.path.split('/').slice(0, -1).join('/') || 'Root';
}

const TAB_PANEL_ID = 'main-tabpanel';
const tabDomId = (id: string) => `tab-${encodeURIComponent(id)}`;
const NAVIGATION_SCREENS = [
  { id: 'contents', label: 'Contents' },
  { id: 'libraries', label: 'Libraries' },
  { id: 'notebooks', label: 'Notebooks' },
  { id: 'notes-files', label: 'Notes & Files' },
] as const;
const assetRegistry = createAssetRegistry(assetTypes);

const REGION_LABELS: Record<FocusRegion, string> = {
  navigation: 'Navigation pane',
  tabs: 'Tabs',
  main: 'Main content',
  'right-pane': 'Right pane',
  status: 'Status bar',
};

const menuGroups: { label: string; items: CommandId[] }[] = [
  {
    label: 'File',
    items: [
      'open-vault',
      'new-library',
      'backup-library',
      'new-contextual',
      'new-notebook',
      'new-note',
      'add-link',
      'new-from-template',
      'save-current-note',
      'export-current-note',
      'close-current-tab',
    ],
  },
  {
    label: 'Insert',
    items: [
      'insert-link',
      'insert-table',
      'insert-math',
      'insert-attachment',
      'open-citation-generator',
      'open-bibliography',
      'annotate-selection',
    ],
  },
  {
    label: 'Format',
    items: [
      'format-bold',
      'format-italic',
      'format-heading1',
      'format-heading2',
      'format-heading3',
      'format-heading4',
      'format-heading5',
      'format-heading6',
      'format-bullet',
      'format-numbered',
      'format-checkbox',
      'format-quote',
      'format-code',
    ],
  },
  {
    label: 'Tools',
    items: [
      'new-task',
      'new-asset',
      'capture-webpage',
      'import-file',
      'reveal-selected',
      'open-selected-external',
      'toggle-bookmark',
      'bookmark-heading-at-cursor',
      'bookmark-position-at-cursor',
      'edit-note-metadata',
      'encrypt-current-note',
      'convert-current-note',
      'convert-note-to-outline',
      'refresh-links',
      'repair-broken-links',
      'find-in-document',
      'find-next',
      'find-previous',
      'check-spelling-grammar',
      'open-thesaurus',
      'show-reminders',
      'create-reminder',
      'show-calendar',
      'show-settings',
      'command-search',
    ],
  },
  {
    label: 'View',
    items: [
      'show-contents',
      'show-libraries',
      'show-notebooks',
      'show-notes-files',
      'organize-library',
      'toggle-right-pane',
      'toggle-read-only-mode',
      'enable-reading-mode',
      'show-assets',
      'focus-search',
    ],
  },
  { label: 'Help', items: ['check-for-updates', 'show-keyboard-shortcuts', 'show-tutorial', 'show-about', 'show-feedback'] },
];

export default function App() {
  usePdfReadingPreferences();
  const [activeRegion, setActiveRegion] = useState<FocusRegion>('navigation');
  const [mode, setMode] = useState<AppMode>('read-only');
  // The mode each still-open note was last in. Cycling tabs must not
  // reset a note to the default open mode: an edited note stays edited
  // when tabbed away from and back to. Entries are pruned when the
  // note closes, so reopening it applies the default again.
  const noteModeRef = useRef<Partial<Record<string, AppMode>>>({});
  // The spreadsheet preview's save function, when one is open: Ctrl+S
  // (save-current-note) calls it when the attachment tab is active.
  const spreadsheetSaveRef = useRef<(() => Promise<void>) | null>(null);
  // The caret each still-open note was last at, same lifetime as the
  // mode memory: tabbing away and back restores it, closing forgets it.
  const noteCaretRef = useRef<Partial<Record<string, { start: number; end: number }>>>({});
  const currentNoteIdRef = useRef<string | undefined>(undefined);
  const [rightPaneOpen, setRightPaneOpen] = useState(true);
  const [focusMode, setFocusMode] = useState(false);
  const [focusAnnouncement, setFocusAnnouncement] = useState('');
  const focusModeRef = useRef(focusMode);
  focusModeRef.current = focusMode;
  // A Focus Mode announcement is transient: clear it once it has had time
  // to be announced, so the footer status message is again the only status
  // region in the normal layout.
  useEffect(() => {
    if (!focusAnnouncement) return undefined;
    const timer = setTimeout(() => setFocusAnnouncement(''), 3000);
    return () => clearTimeout(timer);
  }, [focusAnnouncement]);
  const [activeDialog, setActiveDialog] = useState<DialogId | null>(null);
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [exportRequest, setExportRequest] = useState<{ path: string; protectedNote: boolean } | null>(null);
  const [searchText, setSearchText] = useState('');
  const [statusMessage, setStatusMessage] = useState('Ready');
  const navigationAnnouncementTimer = useRef<ReturnType<typeof setTimeout>>();
  const focusAnnouncementTimer = useRef<ReturnType<typeof setTimeout>>();
  const announceFocusMode = (message: string) => {
    // Delay past the focus move in toggleFocusMode: a live-region update
    // landing in the same tick as a focus change is announced only
    // sometimes, because the screen reader is busy announcing the new
    // focus. The region stays mounted (see the render below), so this is
    // a text change on an existing region, which announces every time.
    clearTimeout(focusAnnouncementTimer.current);
    focusAnnouncementTimer.current = setTimeout(() => setFocusAnnouncement(message), 50);
  };
  const announceNavigation = (message: string) => {
    clearTimeout(navigationAnnouncementTimer.current);
    setStatusMessage('');
    navigationAnnouncementTimer.current = setTimeout(() => {
      if (!document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]'))
        setStatusMessage((current) => (current === '' ? message : current));
    }, 50);
  };
  useEffect(
    () => () => {
      clearTimeout(navigationAnnouncementTimer.current);
      clearTimeout(focusAnnouncementTimer.current);
    },
    [],
  );
  const [selectedTab, setSelectedTab] = useState('notes-files');
  const [contextMenu, setContextMenu] = useState<ContextMenuRequest | null>(null);
  const [deleteLibraryTarget, setDeleteLibraryTarget] = useState<{ name: string; path: string; permanent: boolean } | null>(null);
  const [deleteGuard, setDeleteGuard] = useState<{
    path: string;
    name: string;
    kind: 'note' | 'notebook';
    permanent: boolean;
    taskCount: number;
  } | null>(null);
  const [pinnedTabs, setPinnedTabs] = useState<Set<string>>(() => new Set());
  const [vault, setVault] = useState<VaultInfo | null>(null);
  const [recentLibraries, setRecentLibraries] = useState<RecentLibrary[]>([]);
  const [openNotes, setOpenNotes] = useState<OpenNote[]>([]);
  const [tasks, setTasks] = useState<VaultTask[]>([]);
  const [links, setLinks] = useState<VaultLink[]>([]);
  const [brokenLinkFilter, setBrokenLinkFilter] = useState<string | null>(null);
  const [bookmarks, setBookmarks] = useState<VaultBookmark[]>([]);
  const [pendingBookmarkAnchor, setPendingBookmarkAnchor] = useState<{
    path: string;
    anchor: BookmarkAnchor;
    nonce: number;
  } | null>(null);
  // The last bookmark jump that landed, so switching views after it (or
  // resuming) does not yank the reader back to the saved reading
  // position instead of the bookmarked place. Consumed once by the
  // resume effect, and forgotten when the note is left, so reopening
  // the note resumes normally.
  const bookmarkJumpRef = useRef<{ path: string; anchor: BookmarkAnchor } | null>(null);
  // Fallback undo: one recorded edit history per open note, so undo works
  // even when the textarea's native undo stack is unavailable.
  const editHistoriesRef = useRef(new Map<string, EditHistory>());
  const noteSnapshotsRef = useRef(new Map<string, EditSnapshot>());
  /**
   * Drop the fallback history for a note whose content was replaced
   * from outside the edit flow (an external reload, or a conflict
   * resolved with the disk version): the recorded snapshots no longer
   * chain to the current content, so undoing them would resurrect
   * stale content over newer content.
   */
  const invalidateEditHistory = (id: string) => {
    editHistoriesRef.current.delete(id);
    noteSnapshotsRef.current.delete(id);
    purgeTimelineNote(undoTimelineRef.current, id);
    setHistoryVersion((version) => version + 1);
  };
  /**
   * Bring the fallback snapshot up to content changed by an app action
   * that carries its own undo path (a task toggle, a reminder
   * completion): no history entry is added, but later undos must chain
   * from the new content instead of the stale snapshot.
   */
  const resyncEditSnapshot = (id: string, content: string) => {
    noteSnapshotsRef.current.set(id, {
      content,
      selectionStart: content.length,
      selectionEnd: content.length,
    });
  };
  // Undoable task toggles, newest last. A toggle writes straight to its
  // note file and never enters the note edit history, so without this
  // stack Edit Undo / Ctrl+Z could not reverse an accidental check-off.
  const taskToggleUndoRef = useRef<
    Array<{ path: string; line?: number; taskId?: string; htmlTask: boolean; completeBefore: boolean }>
  >([]);
  // Redo stack for undone toggles, newest last; cleared by any new toggle.
  const taskToggleRedoRef = useRef<typeof taskToggleUndoRef.current>([]);
  // One chronological timeline across edits and toggles: Edit Undo pops
  // the most recent action whatever its kind, instead of draining the
  // edit stack before ever reaching a newer toggle.
  const undoTimelineRef = useRef(createUndoTimeline());
  const [, setHistoryVersion] = useState(0);
  const [taskTabOpen, setTaskTabOpen] = useState(false);
  const [reminderTabOpen, setReminderTabOpen] = useState(false);
  // Closed-app reminder wake focus: the main process records the
  // earliest-due reminder when a wake launch fires, and the renderer
  // reads it once on launch (see the wake focus effects below).
  const [wakeFocus, setWakeFocus] = useState<{ libraryPath: string; reminderId: string } | null>(null);
  const [pendingWakeFocusId, setPendingWakeFocusId] = useState<string | null>(null);
  // A task or reminder opened from a search result: the view to show and
  // the row to focus once it has rendered. Appointments open through a
  // request to the calendar screen instead (it owns its data).
  const [pendingSearchFocus, setPendingSearchFocus] = useState<{
    tab: 'tasks' | 'reminders';
    id: string;
    announce: string;
  } | null>(null);
  const [openAppointmentRequest, setOpenAppointmentRequest] = useState<{ id: string; nonce: number } | null>(null);
  const [calendarTabOpen, setCalendarTabOpen] = useState(false);
  const [assetTabOpen, setAssetTabOpen] = useState(false);
  const [assetInitialPath, setAssetInitialPath] = useState<string | undefined>();
  const [assetDirty, setAssetDirty] = useState(false);
  const [assetBusy, setAssetBusy] = useState(false);
  const [assetSelectionVersion, setAssetSelectionVersion] = useState(0);
  const [assetCreationVersion, setAssetCreationVersion] = useState(0);
  const [taskCreationNotebookPath, setTaskCreationNotebookPath] = useState<string>();
  const [quickTaskStep, setQuickTaskStep] = useState<'library' | 'task' | null>(null);
  type LinkDialogState =
    | { mode: 'add'; notebookPath: string; initialUrl: string; guidance?: string }
    | { mode: 'edit'; path: string; title: string; url: string };
  const [linkDialog, setLinkDialog] = useState<LinkDialogState | null>(null);
  const [dictationActive, setDictationActive] = useState(false);
  const [transcriptionModelChoiceOpen, setTranscriptionModelChoiceOpen] = useState(false);
  const [audioNoteRecording, setAudioNoteRecording] = useState(false);
  const [transcribingAudio, setTranscribingAudio] = useState(false);
  const dictationRecorderRef = useRef<AudioRecorder | null>(null);
  const dictationTranscriberRef = useRef<LocalTranscriber | null>(null);
  const dictationStartPendingRef = useRef(false);
  const audioNoteRecorderRef = useRef<AudioRecorder | null>(null);
  const transcribePendingRef = useRef<string | null>(null);
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [taskCreateError, setTaskCreateError] = useState('');
  const [taskCreating, setTaskCreating] = useState(false);
  const [taskNotePaths, setTaskNotePaths] = useState<string[]>([]);
  const [switchingVault, setSwitchingVault] = useState(false);
  const switchingRef = useRef(false);
  const vaultGenerationRef = useRef(0);
  const vaultPathRef = useRef(vault?.path);
  vaultPathRef.current = vault?.path;
  const updateNoteContent = (id: string, content: string, kind?: string) => {
    if (switchingRef.current) return;
    const note = openNotes.find((item) => item.id === id);
    if (note && note.content !== content) {
      const textarea = editorRef.current;
      const caret =
        textarea && document.activeElement === textarea ? (textarea.selectionStart ?? content.length) : content.length;
      const before: EditSnapshot = noteSnapshotsRef.current.get(id) ?? {
        content: note.content,
        selectionStart: caret,
        selectionEnd: caret,
      };
      const after: EditSnapshot = {
        content,
        selectionStart: caret,
        selectionEnd: textarea && document.activeElement === textarea ? (textarea.selectionEnd ?? caret) : caret,
      };
      const editKind = kind ?? (Math.abs(content.length - before.content.length) <= 2 ? 'typing' : 'edit');
      const history = editHistoriesRef.current.get(id) ?? createEditHistory();
      const next = recordEdit(history, before, after, editKind, Date.now());
      if (next !== history) {
        editHistoriesRef.current.set(id, next);
        setHistoryVersion((version) => version + 1);
        // A new undo step joins the timeline (a coalesced typing burst
        // adds no step, so it adds no token); any new action clears redo.
        if (next.past.length > history.past.length) {
          recordTimelineAction(undoTimelineRef.current, { kind: 'edit', noteId: id });
        } else {
          undoTimelineRef.current.redo = [];
        }
      }
      noteSnapshotsRef.current.set(id, after);
    }
    setOpenNotes((items) => items.map((note) => (note.id === id ? { ...note, content } : note)));
  };

  /** Apply one recorded undo/redo step to the given note. Returns false when it has none. */
  const applyEditHistoryFor = (noteId: string, direction: 'undo' | 'redo'): boolean => {
    const note = openNotes.find((item) => item.id === noteId);
    const history = note ? editHistoriesRef.current.get(note.id) : undefined;
    if (note && history) {
      const textarea = editorRef.current;
      const snapshot = noteSnapshotsRef.current.get(note.id);
      // Defense in depth: if the recorded snapshot no longer matches
      // the displayed content, the chain is broken (a writer bypassed
      // the history). Refuse the step and drop the history rather than
      // restore stale content over newer content.
      if (snapshot && snapshot.content !== note.content) {
        invalidateEditHistory(note.id);
        return false;
      }
      const current: EditSnapshot = noteSnapshotsRef.current.get(note.id) ?? {
        content: note.content,
        selectionStart: textarea?.selectionStart ?? note.content.length,
        selectionEnd: textarea?.selectionEnd ?? note.content.length,
      };
      const result = direction === 'undo' ? undoEdit(history, current) : redoEdit(history, current);
      if (result) {
        editHistoriesRef.current.set(note.id, result.history);
        noteSnapshotsRef.current.set(note.id, result.snapshot);
        setHistoryVersion((version) => version + 1);
        setOpenNotes((items) =>
          items.map((item) => (item.id === note.id ? { ...item, content: result.snapshot.content } : item)),
        );
        // Caret restore only applies to the active note's editor; an
        // undone edit in another open note still shows as unsaved there.
        if (note.id === selectedTab) {
          requestAnimationFrame(() => {
            const editor = editorRef.current;
            if (editor && document.activeElement === editor) {
              try {
                editor.setSelectionRange(result.snapshot.selectionStart, result.snapshot.selectionEnd);
              } catch {
                // Caret restore is best-effort; the content is restored regardless.
              }
            }
          });
        }
        setStatusMessage(direction === 'undo' ? 'Undid the last edit.' : 'Redid the edit.');
        return true;
      }
    }
    return false;
  };

  const stepEditHistory = async (direction: 'undo' | 'redo') => {
    // The timeline owns the order: the most recent action wins, whether
    // it was a note edit or a task toggle. A token for another open note
    // applies to that note in place (its tab shows the unsaved change).
    const timeline = undoTimelineRef.current;
    const token = direction === 'undo' ? takeTimelineUndo(timeline) : takeTimelineRedo(timeline);
    if (token) {
      if (token.kind === 'edit') {
        if (applyEditHistoryFor(token.noteId, direction)) {
          if (direction === 'undo') completeTimelineUndo(timeline, token);
          else completeTimelineRedo(timeline, token);
          return;
        }
      } else {
        const result = direction === 'undo' ? await undoLastTaskToggle() : await redoLastTaskToggle();
        if (result === 'kept') {
          if (direction === 'undo') restoreTimelineUndo(timeline, token);
          else restoreTimelineRedo(timeline, token);
          return;
        }
        if (result === 'done') {
          if (direction === 'undo') completeTimelineUndo(timeline, token);
          else completeTimelineRedo(timeline, token);
          return;
        }
        if (result === 'dropped') return;
        // 'none' means the toggle stack desynced from the timeline;
        // fall through to the native undo below like an empty timeline.
      }
    }
    // No timeline token: fall back to the native undo so fields outside
    // the note editor keep their standard behavior.
    try {
      document.execCommand(direction);
    } catch {
      // No native undo target (e.g. a non-editor view with nothing to undo).
    }
  };

  // Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y are reserved native editing keys: the
  // Edit menu's native roles own them while the menu is active, and they
  // can never be command shortcuts. When a keypress does reach the
  // renderer (for example while the native menu is disabled), the
  // timeline owns it when it has a step; otherwise it falls through to
  // the native undo untouched. The commands remain the always-available
  // path via the command palette.
  const stepEditHistoryRef = useRef(stepEditHistory);
  stepEditHistoryRef.current = stepEditHistory;
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.altKey || !(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      const direction =
        key === 'z' && !event.shiftKey ? 'undo' : key === 'z' || key === 'y' ? 'redo' : null;
      if (!direction) return;
      const timeline = undoTimelineRef.current;
      if ((direction === 'undo' ? timeline.undo.length : timeline.redo.length) === 0) return;
      // Inside the note editor, the timeline always owns Ctrl+Z/Y.
      if (editorRef.current && event.target === editorRef.current) {
        event.preventDefault();
        void stepEditHistoryRef.current(direction);
        return;
      }
      // Outside the editor, route to the timeline only where native undo
      // is a no-op: task checkboxes, buttons, grid cells, and other
      // non-editable targets. Text fields keep their native undo, and an
      // open dialog keeps its own keyboard behavior.
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      const target = event.target instanceof Element ? event.target : null;
      if (
        target?.closest(
          'input:not([type="checkbox"]):not([type="radio"]):not([type="button"]), textarea, select, [contenteditable="true"], [role="textbox"]',
        )
      )
        return;
      event.preventDefault();
      void stepEditHistoryRef.current(direction);
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, []);
  const [taskStatusFilter, setTaskStatusFilter] = useState<'all' | 'open' | 'done'>('open');
  const [taskDueFilter, setTaskDueFilter] = useState<'any' | 'today' | 'overdue' | 'upcoming'>('any');
  const [taskPriorityFilter, setTaskPriorityFilter] = useState('all');
  const [taskScheduleDialog, setTaskScheduleDialog] = useState<VaultTask | null>(null);
  const [citationDialog, setCitationDialog] = useState<'generator' | 'bibliography' | null>(null);
  const [taskPriorityDialog, setTaskPriorityDialog] = useState<VaultTask | null>(null);
  const [taskLinks, setTaskLinks] = useState<TaskLink[]>([]);
  const [dismissedTaskAutoLinks, setDismissedTaskAutoLinks] = useState<string[]>([]);
  const [dismissedTaskAutoLinksLoaded, setDismissedTaskAutoLinksLoaded] = useState(false);
  const [taskLinkDialog, setTaskLinkDialog] = useState<{ task: VaultTask; kind: TaskLinkKind } | null>(null);
  const [taskNotebookFilter, setTaskNotebookFilter] = useState('all');
  const [dueAscending, setDueAscending] = useState(true);
  const [priorityAscending, setPriorityAscending] = useState(true);
  const [taskSort, setTaskSort] = useState<'due' | 'priority'>('due');
  const [treeSelection, setTreeSelection] = useState<string | null>(null);
  const [selectedNotebookPath, setSelectedNotebookPath] = useState<string>();
  const [relocatingPath, setRelocatingPath] = useState<string>();
  const [searchResults, setSearchResults] = useState<VaultSearchResult[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [metadataIndex, setMetadataIndex] = useState<Record<string, string[]>>({});
  const [searchFilters, setSearchFilters] = useState<Omit<VaultSearchQuery, 'text'>>({});
  const [searchScope, setSearchScope] = useState<SearchScope>(() => {
    try {
      const stored = window.localStorage.getItem('a11y-notebook.search-scope');
      return stored === 'current' ? 'current' : 'library';
    } catch {
      return 'library';
    }
  });
  const [settings, setSettings] = useState<NotebookSettings>(DEFAULT_SETTINGS);
  const [settingsLoadFailed, setSettingsLoadFailed] = useState(false);
  const [settingsVaultPath, setSettingsVaultPath] = useState<string>();
  const [securityEnabled, setSecurityEnabled] = useState(false);
  const [recoveryAvailable, setRecoveryAvailable] = useState(false);
  const [securityLocked, setSecurityLocked] = useState(false);
  const navigationHistoryRef = useRef<NavigationHistoryState>(emptyNavigationHistory());

  // Per-library view state, kept in memory for the session: switching away
  // from a library snapshots its open notes, selected tab, notebook, and
  // open task/reminder/calendar tabs, and switching back restores them.
  // Nothing is persisted, so a fresh launch still lands on Notebooks.
  // Unsaved notes block switching, so restored notes are always the saved
  // content; unreadable or locked notes simply stay closed on return.
  interface LibraryUiState {
    openNotePaths: string[];
    selectedTab: string;
    selectedNotebookPath?: string;
    taskTabOpen: boolean;
    reminderTabOpen: boolean;
    calendarTabOpen: boolean;
    pinnedTabs: string[];
  }
  const libraryUiStatesRef = useRef(new Map<string, LibraryUiState>());

  // Keep the current library's snapshot live as the user works, so
  // switching back restores where they were working, not the Libraries
  // picker they switched from: the picker screen itself never overwrites
  // a snapshot. The switch itself only reads the snapshot.
  useEffect(() => {
    if (!vault || selectedTab === 'libraries') return;
    libraryUiStatesRef.current.set(vault.path, {
      openNotePaths: openNotes.map((note) => note.path),
      selectedTab,
      selectedNotebookPath,
      taskTabOpen,
      reminderTabOpen,
      calendarTabOpen,
      pinnedTabs: [...pinnedTabs],
    });
  }, [vault, openNotes, selectedTab, selectedNotebookPath, taskTabOpen, reminderTabOpen, calendarTabOpen, pinnedTabs]);

  // Cross-restart reopen landing: when no in-session snapshot exists,
  // restore the last notebook recorded in this library's settings, so
  // reopening lands on that notebook's Notes and Files. Returns true
  // when a notebook was restored. Anything missing, deleted, or renamed
  // falls through to the caller's landing, unchanged.
  const restorePersistedNotebook = useCallback(async (opened: VaultInfo, generation: number): Promise<boolean> => {
    let lastNotebookPath: string | undefined;
    try {
      lastNotebookPath = (await window.a11yNotebook?.vault.getSettings?.())?.lastNotebookPath;
    } catch {
      return false;
    }
    if (!lastNotebookPath) return false;
    const notebook = findEntry(opened.entries, lastNotebookPath);
    if (notebook?.kind !== 'notebook') return false;
    // A second switch mid-read must not apply stale state to the new library.
    if (generation !== vaultGenerationRef.current || vaultPathRef.current !== opened.path) return false;
    setTreeSelection(lastNotebookPath);
    setSelectedNotebookPath(lastNotebookPath);
    setSelectedTab('notes-files');
    return true;
  }, []);

  const restoreLibraryUiState = useCallback(async (opened: VaultInfo) => {
    const snapshot = libraryUiStatesRef.current.get(opened.path);
    const generation = vaultGenerationRef.current;
    if (!snapshot) {
      await restorePersistedNotebook(opened, generation);
      return;
    }
    const bridge = window.a11yNotebook?.vault;
    const restored: OpenNote[] = [];
    if (bridge?.readNote) {
      for (const notePath of snapshot.openNotePaths) {
        const entry = findEntry(opened.entries, notePath);
        if (!entry || entry.kind !== 'note' || !isManagedEntry(entry)) continue;
        try {
          const loaded = await bridge.readNote(notePath);
          const content = /\.html?$/i.test(notePath) ? sanitizeNoteHtml(loaded, notePath) : loaded;
          restored.push({
            id: notePath,
            path: notePath,
            title: entry.name.replace(/\.(?:md|html|htm|txt)$/i, ''),
            content,
            saved: content,
          });
        } catch {
          // Unreadable or locked notes simply stay closed on return.
        }
      }
    }
    // A second switch mid-restore must not apply stale state to the new library.
    if (generation !== vaultGenerationRef.current || vaultPathRef.current !== opened.path) return;
    if (restored.length) setOpenNotes(restored);
    setTaskTabOpen(snapshot.taskTabOpen);
    setReminderTabOpen(snapshot.reminderTabOpen);
    setCalendarTabOpen(snapshot.calendarTabOpen);
    setPinnedTabs(
      new Set(
        snapshot.pinnedTabs.filter(
          (id) =>
            restored.some((note) => note.id === id) ||
            (id === 'tasks' && snapshot.taskTabOpen) ||
            (id === 'reminders' && snapshot.reminderTabOpen) ||
            (id === 'calendar' && snapshot.calendarTabOpen),
        ),
      ),
    );
    const tabAvailable =
      NAVIGATION_SCREENS.some((screen) => screen.id === snapshot.selectedTab) ||
      (snapshot.selectedTab === 'tasks' && snapshot.taskTabOpen) ||
      (snapshot.selectedTab === 'reminders' && snapshot.reminderTabOpen) ||
      (snapshot.selectedTab === 'calendar' && snapshot.calendarTabOpen) ||
      restored.some((note) => note.id === snapshot.selectedTab);
    if (tabAvailable) setSelectedTab(snapshot.selectedTab);
    if (snapshot.selectedNotebookPath) {
      const notebook = findEntry(opened.entries, snapshot.selectedNotebookPath);
      if (notebook?.kind === 'notebook') setSelectedNotebookPath(snapshot.selectedNotebookPath);
    }
  }, [restorePersistedNotebook]);

  // Save settings only when the last load succeeded: after a failed load
  // the in-memory settings are defaults, and persisting them would
  // overwrite the stored settings file. Returns false when blocked.
  const persistSettings = useCallback(
    async (next: NotebookSettings): Promise<boolean> => {
      if (settingsLoadFailed) {
        setStatusMessage('Settings did not load, so saving is disabled to protect your stored settings.');
        return false;
      }
      await window.a11yNotebook!.vault.saveSettings(next);
      setSettings(next);
      return true;
    },
    [settingsLoadFailed],
  );

  // Record the last notebook in this library's settings as notebooks are
  // selected, so reopening the library after a restart restores it. The
  // write only runs once settings have loaded for this library, so a
  // stale in-memory copy can never overwrite another library's file;
  // navigating back to the Notebooks landing never clears the record,
  // matching the in-session snapshot, which keeps the last notebook too.
  useEffect(() => {
    if (!vault || !selectedNotebookPath || selectedTab === 'libraries') return;
    if (settingsLoadFailed || settingsVaultPath !== vault.path) return;
    if (switchingRef.current) return;
    if (settings.lastNotebookPath === selectedNotebookPath) return;
    void persistSettings({ ...settings, lastNotebookPath: selectedNotebookPath });
  }, [vault, selectedNotebookPath, selectedTab, settings, settingsVaultPath, settingsLoadFailed, persistSettings]);

  const applyHistoryLocation = (location: NavigationLocation) => {
    if (location.notebookPath) {
      setSelectedNotebookPath(location.notebookPath);
      setTreeSelection(location.notebookPath);
    } else {
      setSelectedNotebookPath(undefined);
    }
    setSelectedTab(location.tab);
    setPendingFocus('main');
  };
  const goBackInHistory = () => {
    const { state, location } = historyGoBack(navigationHistoryRef.current);
    if (!location) {
      setStatusMessage('Nothing to go back to.');
      return;
    }
    navigationHistoryRef.current = state;
    applyHistoryLocation(location);
  };
  const goForwardInHistory = () => {
    const { state, location } = historyGoForward(navigationHistoryRef.current);
    if (!location) {
      setStatusMessage('Nothing to go forward to.');
      return;
    }
    navigationHistoryRef.current = state;
    applyHistoryLocation(location);
  };

  // Record browsing locations for Alt+ArrowLeft / Alt+ArrowRight. A
  // location applied by going back or forward equals the entry the
  // history index already points at, and recordLocation treats that
  // as a no-op, so restores never truncate or duplicate the stack.
  useEffect(() => {
    if (!vault || securityLocked) return;
    navigationHistoryRef.current = recordHistoryLocation(navigationHistoryRef.current, {
      tab: selectedTab,
      notebookPath: selectedNotebookPath,
    });
  }, [selectedTab, selectedNotebookPath, vault, securityLocked]);
  const securityLockedRef = useRef(securityLocked);
  securityLockedRef.current = securityLocked;
  const [lockedEditPaths, setLockedEditPaths] = useState<Set<string>>(() => new Set());
  const [encryptedNotePath, setEncryptedNotePath] = useState<string | null>(null);
  const [notePasswordDialog, setNotePasswordDialog] = useState<{
    action: 'encrypt' | 'unlock';
    entry: VaultEntry;
  } | null>(null);
  const [itemDialog, setItemDialog] = useState<ItemDialogRequest | null>(null);
  const [bookmarkNameRequest, setBookmarkNameRequest] = useState<BookmarkNameRequest | null>(null);
  const [organizeOpen, setOrganizeOpen] = useState(false);
  // Opening an item from the Organize dialog closes the dialog, and the
  // dialog's focus restore re-focuses the pre-dialog grid cell — which
  // re-selects that cell's item, overwriting the opened item's selection.
  // Remember the opened path and re-assert it once the dialog has closed.
  const organizeOpenedPathRef = useRef<string | null>(null);
  useEffect(() => {
    if (!organizeOpen && organizeOpenedPathRef.current) {
      const path = organizeOpenedPathRef.current;
      organizeOpenedPathRef.current = null;
      setTreeSelection(path);
    }
  }, [organizeOpen]);
  const [propertiesPath, setPropertiesPath] = useState<string | null>(null);
  const [protectedRequest, setProtectedRequest] = useState<{
    targetPath: string;
    targetName: string;
    blockingPath: string;
    blockingName: string;
    blockingIsTarget: boolean;
    action: ProtectedAction;
  } | null>(null);
  const [attachment, setAttachment] = useState<AttachmentPreview | null>(null);
  const [externalFile, setExternalFile] = useState<VaultEntry | null>(null);
  const externalOperationGeneration = useRef(0);
  useEffect(() => {
    externalOperationGeneration.current += 1;
    setExternalFile(null);
  }, [vault?.path, securityLocked]);
  const [imageAlt, setImageAlt] = useState('');
  const [noteAnnotations, setNoteAnnotations] = useState<NoteAnnotation[]>([]);
  const [userTemplates, setUserTemplates] = useState<NoteTemplate[]>([]);
  const [pendingFocus, setPendingFocus] = useState<FocusTarget | null>(null);
  // Set when a closed note or file should hand focus back to the Notes and
  // Files grid: the path of the item to focus, or null for the grid's active
  // cell. Undefined means no grid focus is pending.
  const [pendingGridFocusPath, setPendingGridFocusPath] = useState<string | null | undefined>(undefined);
  // Set when a closed library should hand focus to the Libraries grid.
  const [pendingLibraryGridFocus, setPendingLibraryGridFocus] = useState(false);
  // Set when an opened library should hand focus to the Notebooks grid.
  const [pendingNotebooksGridFocus, setPendingNotebooksGridFocus] = useState(false);
  const updater = useUpdater();
  const synchronization = useVaultChanges(vault, openNotes, setOpenNotes, setVault, setStatusMessage, (replacedPath) =>
    invalidateEditHistory(replacedPath),
  );
  const { checking: checkingDisk, checkDisk, clearAllConflicts } = synchronization;
  const editorRef = useRef<HTMLTextAreaElement>(null);
  // A note that was just created opens in Editing mode with the editor
  // focused, regardless of the default open mode. The mode effect below
  // would otherwise overwrite that explicit edit mode with the default
  // when the new tab becomes current, and a setTimeout focus loses to
  // the panel-focus effect. These refs are consumed once, after render.
  const forceEditNoteRef = useRef<string | null>(null);
  const pendingEditorFocusRef = useRef<{ path: string; cursor?: number } | null>(null);
  /** Set when the mode toggle asks for edit: the editor takes focus once it renders. */
  const focusEditorOnEditRef = useRef(false);
  const editorToolsRef = useRef<EditorToolsHandle>(null);
  const editLockStart = useRef<{ path: string; timestamp: number } | null>(null);
  const currentNote = openNotes.find((item) => item.id === selectedTab);
  const currentNoteId = currentNote?.id;
  currentNoteIdRef.current = currentNoteId;
  const contextualNewCommand: CommandId =
    selectedTab === 'libraries'
      ? 'new-library'
      : selectedTab === 'notebooks'
        ? 'new-notebook'
        : selectedTab === 'tasks'
          ? 'new-task'
          : selectedTab === 'assets'
            ? 'new-asset'
            : selectedTab === 'reminders'
              ? 'create-reminder'
              : 'new-note';
  const currentEditLockKey = currentNote && vault ? `${vault.path}\0${currentNote.path}` : null;
  const currentNoteEditLocked = !!currentEditLockKey && lockedEditPaths.has(currentEditLockKey);
  const currentNoteProtected =
    !!currentNote && !!findEntryInTree(vault?.entries ?? [], currentNote.path)?.protected;
  const openProtectedRequest = (path: string, action: ProtectedAction) => {
    const entries = vault?.entries ?? [];
    const block = findProtectionBlockInTree(entries, path);
    const entry = findEntryInTree(entries, path);
    setProtectedRequest({
      targetPath: path,
      targetName: entry?.name ?? path.split('/').at(-1) ?? path,
      blockingPath: block?.path ?? path,
      blockingName: block?.name ?? entry?.name ?? path,
      blockingIsTarget: !block || block.path === path,
      action,
    });
  };
  useEffect(() => {
    const forced = forceEditNoteRef.current;
    if (forced) {
      forceEditNoteRef.current = null;
      if (forced === currentNoteId && !securityLocked && !currentNoteEditLocked && !currentNoteProtected) {
        setMode('edit');
        return;
      }
    }
    // Switching to a view tab never resets a note's mode; the mode is
    // restored when that note becomes current again.
    if (!currentNoteId) return;
    // A locked note (or a security lock) always shows read-only, and the
    // forced mode is never recorded as the note's remembered mode. The
    // remembered entry is forgotten so that unlocking returns to the
    // default mode, exactly as before mode memory existed. A protected
    // note behaves the same way: read-only until it is unprotected.
    if (securityLocked || currentNoteEditLocked || currentNoteProtected) {
      delete noteModeRef.current[currentNoteId];
      setMode('read-only');
      return;
    }
    const remembered = noteModeRef.current[currentNoteId];
    if (remembered) {
      setMode(remembered);
      return;
    }
    const next =
      settings.defaultNoteOpenMode === 'edit' && !securityLocked && !currentNoteEditLocked && !currentNoteProtected
        ? 'edit'
        : 'read-only';
    noteModeRef.current[currentNoteId] = next;
    setMode(next);
  }, [
    selectedTab,
    currentNoteId,
    settings.defaultNoteOpenMode,
    settingsVaultPath,
    securityLocked,
    currentNoteEditLocked,
    currentNoteProtected,
  ]);
  useEffect(() => {
    if (currentNoteId && !securityLocked && !currentNoteEditLocked && !currentNoteProtected)
      noteModeRef.current[currentNoteId] = mode;
  }, [mode, currentNoteId, securityLocked, currentNoteEditLocked, currentNoteProtected]);
  useEffect(() => {
    const open = new Set(openNotes.map((note) => note.id));
    for (const id of Object.keys(noteModeRef.current)) {
      if (!open.has(id)) delete noteModeRef.current[id];
    }
    for (const id of Object.keys(noteCaretRef.current)) {
      if (!open.has(id)) delete noteCaretRef.current[id];
    }
  }, [openNotes]);
  /**
   * Remember the edit caret on every user caret move, so returning to
   * the note restores it. Capture phase: the select event's bubbling
   * is unreliable, and programmatic caret sets (Find, jumps) record
   * separately because they fire no select event.
   */
  useEffect(() => {
    const saveCaret = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLTextAreaElement) || target !== editorRef.current) return;
      const id = currentNoteIdRef.current;
      if (!id) return;
      noteCaretRef.current[id] = { start: target.selectionStart ?? 0, end: target.selectionEnd ?? 0 };
    };
    document.addEventListener('select', saveCaret, true);
    return () => document.removeEventListener('select', saveCaret, true);
  }, []);
  /**
   * Restore the remembered caret when a note tab becomes current in
   * edit mode. Focus is deliberately not moved: Ctrl+Tab announces
   * only, and the caret is in place when focus enters the editor.
   * A pending editor-focus jump runs after this effect and wins.
   */
  useEffect(() => {
    if (mode !== 'edit' || !currentNoteId) return;
    const caret = noteCaretRef.current[currentNoteId];
    const textarea = editorRef.current;
    if (!caret || !textarea) return;
    const length = textarea.value.length;
    textarea.setSelectionRange(Math.min(caret.start, length), Math.min(caret.end, length));
  }, [selectedTab, currentNoteId, mode]);
  /**
   * Move focus into the editor when the mode toggle switches a note to
   * edit mode. The request is raised only by the toggle command, so tab
   * switches and note opens — which also flip the mode through the
   * remembered-mode restore — never steal focus, and the caret restore
   * above has already run, so the caret is in place when focus lands.
   * The citation dialog's switch-to-edit flips the mode the same way
   * but keeps focus in the dialog: the user is mid-citation there.
   * Rich text has no textarea, so the rich-text editor takes focus when
   * it is the active form.
   */
  useEffect(() => {
    if (!focusEditorOnEditRef.current) return;
    focusEditorOnEditRef.current = false;
    if (mode !== 'edit' || !currentNoteId || citationDialog) return;
    const richEditor = document.querySelector<HTMLElement>('[role="textbox"][aria-label="Rich text editor"]');
    if (richEditor) {
      richEditor.focus();
      return;
    }
    editorRef.current?.focus();
  }, [mode, currentNoteId, citationDialog]);
  const clearEditLock = (path: string) => {
    const key = `${vault?.path ?? ''}\0${path}`;
    setLockedEditPaths((paths) => {
      const updated = new Set(paths);
      updated.delete(key);
      return updated;
    });
  };
  const allEntries = flattenEntries(vault?.entries ?? []);
  const notebooks = allEntries.filter((entry) => entry.kind === 'notebook').map((entry) => entry.path);
  const notePaths = allEntries
    .filter((entry) => entry.kind === 'note' && isManagedEntry(entry) && !assetRegistry.resolve(entry.path))
    .map((entry) => entry.path);
  // Reminders only link to a note; they never write into it, so they do
  // not need the managed provenance that tasks require. A note whose
  // origin record was lost (for example, a cloud sync replacing the file)
  // can still receive reminders.
  const reminderNotePaths = allEntries
    .filter((entry) => entry.kind === 'note' && !assetRegistry.resolve(entry.path))
    .map((entry) => entry.path);
  const filePaths = allEntries.filter((entry) => entry.kind === 'attachment').map((entry) => entry.path);
  const beginExport = async (relativePath: string) => {
    try {
      const protectedNote = (await window.a11yNotebook?.vault.isNoteEncrypted?.(relativePath)) ?? false;
      setExportRequest({ path: relativePath, protectedNote });
    } catch {
      setStatusMessage('Could not inspect note protection before export.');
    }
  };
  const activeConflict = synchronization.conflicts.find((conflict) =>
    openNotes.some((note) => note.path === conflict.path),
  );
  const annotationTools = useAnnotations({
    path: currentNote?.path ?? null,
    content: currentNote?.content ?? '',
    enabled: mode === 'read-only' && !!currentNote,
    annotations: noteAnnotations,
    bindShortcut: false,
    announce: setStatusMessage,
    onAdd: async (annotation) => {
      const saved = await window.a11yNotebook!.vault.addAnnotation(annotation);
      setNoteAnnotations((items) => [...items, saved]);
    },
    onUpdate: async (id, update) => {
      const saved = await window.a11yNotebook!.vault.updateAnnotation(currentNote!.path, id, update);
      setNoteAnnotations((items) => items.map((item) => (item.id === id ? saved : item)));
    },
    onDelete: async (id) => {
      await window.a11yNotebook!.vault.deleteAnnotation(currentNote!.path, id);
      setNoteAnnotations((items) => items.filter((item) => item.id !== id));
    },
  });

  useEffect(() => {
    if (!(settings.noteEditLockMinutes ?? 0)) return;
    if (!currentNote || currentNote.content === currentNote.saved) {
      editLockStart.current = null;
      return;
    }
    const path = currentNote.path;
    const title = currentNote.title;
    const key = `${vault?.path ?? ''}\0${path}`;
    if (editLockStart.current?.path !== key) editLockStart.current = { path: key, timestamp: Date.now() };
    const remaining = (settings.noteEditLockMinutes ?? 0) * 60_000 - (Date.now() - editLockStart.current.timestamp);
    const timer = window.setTimeout(
      () => {
        setLockedEditPaths((paths) => new Set(paths).add(key));
        setMode('read-only');
        setStatusMessage(`Editing locked for ${title}; save the unsaved changes to continue.`);
      },
      Math.max(0, remaining),
    );
    return () => window.clearTimeout(timer);
  }, [currentNote, settings.noteEditLockMinutes, vault?.path]);

  const searchRef = useRef<HTMLInputElement>(null);
  const navigationRef = useRef<HTMLElement>(null);
  const tabListRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const tabPanelRef = useRef<HTMLElement>(null);
  const rightPaneRef = useRef<HTMLElement>(null);
  const statusRef = useRef<HTMLElement>(null);
  const tabs = [
    ...NAVIGATION_SCREENS.filter((tab) => tab.id === selectedTab),
    ...(taskTabOpen ? [{ id: 'tasks', label: 'Tasks' }] : []),
    ...(reminderTabOpen ? [{ id: 'reminders', label: 'Reminders' }] : []),
    ...(calendarTabOpen ? [{ id: 'calendar', label: 'Calendar' }] : []),
    ...(assetTabOpen ? [{ id: 'assets', label: 'Cognitive tools' }] : []),
    ...(attachment ? [{ id: 'attachment', label: attachment.path.split('/').at(-1) ?? attachment.path }] : []),
    ...openNotes.map((note) => ({
      id: note.id,
      label: `${note.title}${note.content !== note.saved ? ' (unsaved)' : ''}`,
    })),
  ];
  const selectedNotebookName = findEntry(vault?.entries ?? [], selectedNotebookPath ?? null)?.name;
  const libraryContext = vault ? ` in ${vault.name}` : '';
  const viewTitles: Record<string, string> = {
    contents: `Contents${libraryContext}`,
    libraries: vault?.name ?? 'Libraries',
    notebooks: `Notebooks${libraryContext}`,
    'notes-files': selectedNotebookName
      ? `Notes and Files in ${selectedNotebookName}`
      : `Notes and Files${libraryContext}`,
    tasks: `Tasks${libraryContext}`,
    assets: `Cognitive Tools${libraryContext}`,
    reminders: `Reminders${libraryContext}`,
    calendar: `Calendar${libraryContext}`,
  };
  const activeViewTitle =
    viewTitles[selectedTab] ?? currentNote?.title ?? tabs.find((tab) => tab.id === selectedTab)?.label ?? 'Welcome';
  /**
   * The Ctrl+Tab cycle: open view tabs, the selected notebook's Notes
   * and Files stop, the attachment, and open notes — in tab-strip
   * order. The generic navigation screens, settings, and dialogs are
   * never stops; a notebook stop exists only while that notebook is
   * selected. Built from live state, so a closed item leaves the
   * cycle at once. Switching tabs only changes selectedTab, so an
   * open note keeps its content, unsaved state, and mode.
   */
  const cycleTabs = [
    ...(selectedNotebookPath ? [{ id: 'notes-files', label: viewTitles['notes-files'] }] : []),
    ...(taskTabOpen ? [{ id: 'tasks', label: 'Tasks' }] : []),
    ...(reminderTabOpen ? [{ id: 'reminders', label: 'Reminders' }] : []),
    ...(calendarTabOpen ? [{ id: 'calendar', label: 'Calendar' }] : []),
    ...(assetTabOpen ? [{ id: 'assets', label: 'Cognitive tools' }] : []),
    ...(attachment ? [{ id: 'attachment', label: attachment.path.split('/').at(-1) ?? attachment.path }] : []),
    ...openNotes.map((note) => ({
      id: note.id,
      label: `${note.title}${note.content !== note.saved ? ' (unsaved)' : ''}`,
    })),
  ];
  const calendarGeneration = vaultGenerationRef.current;
  const reminderState = useReminders(
    securityLocked ? undefined : vault?.path,
    (relative) => {
      if (switchingRef.current) return;
      if (relative === undefined) {
        setSelectedTab('calendar');
        return;
      }
      const entry = findEntry(vault?.entries ?? [], relative);
      if (entry) void openEntry(entry).catch(() => setStatusMessage('Could not open reminder note.'));
      else setStatusMessage('The reminder note is no longer available in this library.');
    },
    setStatusMessage,
  );

  useEffect(() => {
    let cancelled = false;
    setSettingsVaultPath(undefined);
    setSettingsLoadFailed(false);
    if (securityLocked) return;
    void window.a11yNotebook?.vault
      .getSettings?.()
      .then((value) => {
        if (!cancelled) {
          setSettings(value);
          setSettingsVaultPath(vault?.path);
          setSettingsLoadFailed(false);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setSettingsLoadFailed(true);
          setStatusMessage(settingsLoadStatusMessage(error));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [vault?.path, securityLocked]);

  useLayoutEffect(() => {
    setSelectedNotebookPath(undefined);
  }, [vault?.path, securityLocked]);

  useEffect(() => {
    if (
      relocatingPath &&
      (selectedNotebookPath === relocatingPath || selectedNotebookPath?.startsWith(`${relocatingPath}/`))
    )
      return;
    setSelectedNotebookPath((current) =>
      current && findEntry(vault?.entries ?? [], current)?.kind === 'notebook' ? current : undefined,
    );
  }, [vault, relocatingPath, selectedNotebookPath]);

  useEffect(() => {
    // The OS Increase Contrast setting wins over the stored theme: when
    // it asks for more contrast, the high-contrast theme renders even
    // though Settings still shows the stored choice. The listener keeps
    // this live when the OS setting changes mid-session. Test and
    // non-browser environments may lack matchMedia entirely.
    const media =
      typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-contrast: more)') : undefined;
    if (!media) {
      document.documentElement.dataset.theme = settings.theme;
      return;
    }
    const applyTheme = () => {
      document.documentElement.dataset.theme = media.matches ? 'high-contrast' : settings.theme;
    };
    applyTheme();
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', applyTheme);
      return () => media.removeEventListener('change', applyTheme);
    }
    if (typeof media.addListener === 'function') {
      media.addListener(applyTheme);
      return () => media.removeListener(applyTheme);
    }
    return;
  }, [settings.theme]);

  useEffect(() => {
    document.documentElement.style.fontSize = `${settings.fontSize}px`;
  }, [settings.fontSize]);

  useEffect(() => {
    window.a11yNotebook?.setZoomFactor?.((settings.zoomPercent ?? 100) / 100);
    document.documentElement.dataset.focusRing = settings.focusRing ?? 'standard';
    document.documentElement.dataset.reducedMotion = settings.reducedMotion ? 'true' : 'false';
  }, [settings.zoomPercent, settings.focusRing, settings.reducedMotion]);

  const autoBackupRunningRef = useRef(false);
  useEffect(() => {
    if (!vault || securityLocked || switchingVault) return;
    if (!settings.autoBackupEnabled) return;
    const runIfDue = async () => {
      if (autoBackupRunningRef.current) return;
      const last = settings.lastAutoBackupAt ? Date.parse(settings.lastAutoBackupAt) : Number.NaN;
      const intervalMs = (settings.autoBackupIntervalDays ?? 7) * 24 * 60 * 60 * 1000;
      if (!Number.isNaN(last) && Date.now() - last < intervalMs) return;
      const create = window.a11yNotebook?.vault.createAutoBackup;
      if (!create) return;
      autoBackupRunningRef.current = true;
      try {
        const result = await create(settings.autoBackupFolder ?? '', settings.autoBackupKeepCount ?? 5);
        const next = { ...settings, lastAutoBackupAt: new Date().toISOString() };
        if (await persistSettings(next)) {
          setStatusMessage(`Automatic backup created (${result.files} files).`);
        }
      } catch {
        setStatusMessage('Automatic backup failed; it will be retried later.');
      } finally {
        autoBackupRunningRef.current = false;
      }
    };
    void runIfDue();
    const timer = window.setInterval(() => void runIfDue(), 60 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [vault, securityLocked, switchingVault, settings, persistSettings]);

  useEffect(() => {
    let cancelled = false;
    setNoteAnnotations([]);
    if (currentNote?.path)
      void window.a11yNotebook?.vault
        .getAnnotations?.(currentNote.path)
        .then((items) => {
          if (!cancelled) setNoteAnnotations(items);
        })
        .catch(() => setStatusMessage('Could not load annotations.'));
    return () => {
      cancelled = true;
    };
  }, [currentNote?.path, vault]);

  useEffect(() => {
    const status = window.a11yNotebook?.vault.isNoteEncrypted;
    const path = currentNote?.path;
    if (!path || !status) return;
    let cancelled = false;
    void status(path)
      .then((encrypted) => {
        if (!cancelled) setEncryptedNotePath(encrypted ? path : null);
      })
      .catch(() => {
        if (!cancelled) setEncryptedNotePath(null);
      });
    return () => {
      cancelled = true;
    };
  }, [currentNote?.path, vault]);

  useEffect(() => {
    const bridge = window.a11yNotebook;
    const generation = vaultGenerationRef.current;
    if (bridge)
      void bridge.vault
        .get()
        .then((latest) => {
          if (!switchingRef.current && generation === vaultGenerationRef.current) {
            setVault(latest);
            if (latest) setSelectedTab('notebooks');
            else {
              // No library to reopen: land on the Libraries picker itself,
              // so opening a library is keyboard-reachable and announced
              // instead of stranding the user on Notes and Files with
              // nothing open.
              setSelectedTab('libraries');
              setPendingLibraryGridFocus(true);
            }
          }
        })
        .catch(() => {
          setStatusMessage('Could not open the last library.');
          setSelectedTab('libraries');
          setPendingLibraryGridFocus(true);
        });
    if (bridge?.vault.getRecentLibraries)
      void bridge.vault
        .getRecentLibraries()
        .then((recent) => {
          if (generation === vaultGenerationRef.current) setRecentLibraries(recent);
        })
        .catch(() => undefined);
  }, []);

  // Fresh-launch reopen landing, first mount only: in-app switches are
  // restored by openLibrary, so this must not run again. A passive
  // effect runs after the vault-change layout effect clears any stale
  // notebook for the new library, so the restored notebook survives;
  // restoring inside the mount promise above would batch with the
  // vault change and be wiped on that render.
  const mountRestoreAppliedRef = useRef(false);
  useEffect(() => {
    if (!vault || mountRestoreAppliedRef.current) return;
    mountRestoreAppliedRef.current = true;
    // Fresh launch only, consulting the persisted value directly: any
    // snapshot for this library at this point is the landing snapshot
    // the snapshot effect just wrote for this same mount, not real
    // navigation state, so going through restoreLibraryUiState would
    // restore the landing and never reach the persisted notebook.
    // In-app switches keep using restoreLibraryUiState, where the
    // lookup happens before the landing snapshot is written.
    void restorePersistedNotebook(vault, vaultGenerationRef.current);
  }, [vault, restorePersistedNotebook]);

  useEffect(() => {
    let cancelled = false;
    const bridge = window.a11yNotebook?.vault;
    if (bridge?.getSecurityStatus) {
      void bridge
        .getSecurityStatus()
        .then((status) => {
          if (!cancelled) {
            setSecurityEnabled(status.enabled);
            setSecurityLocked(status.locked);
            setRecoveryAvailable(status.recoveryAvailable);
          }
        })
        .catch(() => setStatusMessage('Could not read library security status.'));
    }
    return () => {
      cancelled = true;
    };
  }, [vault?.path]);

  useEffect(() => {
    const unsubscribe = window.a11yNotebook?.vault.onSecurityLocked?.(() => {
      securityLockedRef.current = true;
      vaultGenerationRef.current += 1;
      setSecurityLocked(true);
      clearAllConflicts();
      setOpenNotes([]);
      setNotePasswordDialog(null);
      setAttachment(null);
      setLockedEditPaths(new Set());
      setNoteAnnotations([]);
      setTasks([]);
      setLinks([]);
      setBookmarks([]);
      setSearchResults([]);
      setSearchText('');
      setSearchFilters({});
      setTags([]);
      setUserTemplates([]);
      setActiveDialog(null);
      setItemDialog(null);
      setTaskDialogOpen(false);
      setTaskCreating(false);
      setTaskNotePaths([]);
      setContextMenu(null);
      setExportRequest(null);
      setSelectedTab((current) =>
        NAVIGATION_SCREENS.some((screen) => screen.id === current) ||
        ['tasks', 'reminders'].includes(current)
          ? current
          : 'notes-files',
      );
      setPendingFocus(null);
      setAssetTabOpen(false);
      setAssetDirty(false);
      setAssetBusy(false);
      setAssetInitialPath(undefined);
      setMode('read-only');
      setVault((current) => (current ? { ...current, entries: [] } : current));
      setStatusMessage('Library locked. Unlock it to continue.');
    });
    return unsubscribe;
  }, [clearAllConflicts]);

  useEffect(() => {
    let lastPing = 0;
    const activity = () => {
      const now = Date.now();
      if (now - lastPing < 30_000) return;
      lastPing = now;
      void window.a11yNotebook?.vault.getSecurityStatus?.().catch(() => undefined);
    };
    window.addEventListener('pointerdown', activity);
    window.addEventListener('keydown', activity);
    return () => {
      window.removeEventListener('pointerdown', activity);
      window.removeEventListener('keydown', activity);
    };
  }, []);

  // Which vault each task dataset was loaded for: reconciliation must
  // only run when the tasks, links, and dismissed list all belong to the
  // current vault, never on stale data left over from a vault switch.
  const taskDataVaultRef = useRef({ tasks: '', links: '', dismissed: '' });
  useEffect(() => {
    let cancelled = false;
    if (!vault || !window.a11yNotebook) {
      setTasks([]);
      return;
    }
    void window.a11yNotebook.vault
      .getTasks()
      .then((items) => {
        if (!cancelled) {
          taskDataVaultRef.current.tasks = vault.path;
          setTasks(items);
        }
      })
      .catch(() => setStatusMessage('Could not load tasks.'));
    void window.a11yNotebook.vault
      .getTaskLinks?.()
      .then((items) => {
        if (!cancelled) {
          taskDataVaultRef.current.links = vault.path;
          setTaskLinks(items);
        }
      })
      .catch(() => undefined);
    const dismissedPromise = window.a11yNotebook.vault.getDismissedTaskAutoLinks?.();
    if (dismissedPromise) {
      void dismissedPromise
        .then((items) => {
          if (!cancelled) {
            taskDataVaultRef.current.dismissed = vault.path;
            setDismissedTaskAutoLinks(items);
            setDismissedTaskAutoLinksLoaded(true);
          }
        })
        .catch(() => {
          // Without the dismissed list, reconciliation would resurrect
          // links the user removed; treat a failed load as an empty list
          // only once the load has settled, so the gate below still waits.
          if (!cancelled) {
            taskDataVaultRef.current.dismissed = vault.path;
            setDismissedTaskAutoLinksLoaded(true);
          }
        });
    } else {
      // No dismissed-list method on this build: reconciliation stays
      // gated (the vault guard above requires a loaded dismissed list),
      // so nothing can resurrect a removed link.
    }
    return () => {
      cancelled = true;
    };
  }, [vault]);

  // Every task links to the note it lives in, unless the user removed
  // that link. Reconciling on the task list (not on the links) covers
  // every way a task appears — dialog, Quick Task, or typed into a note
  // — and backfills tasks created before auto-links existed. It runs on
  // tasks only, so saving the links cannot re-trigger it; and it waits
  // for the dismissed list, so a removed link is never resurrected by
  // a refresh that raced the dismissal load.
  const taskLinksRef = useRef(taskLinks);
  taskLinksRef.current = taskLinks;
  const dismissedTaskAutoLinksRef = useRef(dismissedTaskAutoLinks);
  dismissedTaskAutoLinksRef.current = dismissedTaskAutoLinks;
  useEffect(() => {
    if (!vault || !dismissedTaskAutoLinksLoaded) return;
    const loaded = taskDataVaultRef.current;
    if (loaded.tasks !== vault.path || loaded.links !== vault.path || loaded.dismissed !== vault.path) return;
    const bridge = window.a11yNotebook?.vault;
    if (!bridge?.saveTaskLinks) return;
    const result = reconcileTaskAutoLinks(tasks, taskLinksRef.current, dismissedTaskAutoLinksRef.current);
    if (!result.changed) return;
    let cancelled = false;
    void bridge
      .saveTaskLinks(result.links)
      .then((saved) => {
        if (!cancelled) setTaskLinks(saved);
      })
      .catch(() => undefined);
    if (result.dismissed.length !== dismissedTaskAutoLinksRef.current.length) {
      const saveDismissed = bridge.saveDismissedTaskAutoLinks?.(result.dismissed);
      if (saveDismissed) {
        void saveDismissed
          .then((saved) => {
            if (!cancelled) setDismissedTaskAutoLinks(saved);
          })
          .catch(() => undefined);
      }
    }
    return () => {
      cancelled = true;
    };
  }, [tasks, vault, dismissedTaskAutoLinksLoaded]);
  // Task links are private metadata, but the Tasks screen displays them,
  // so a cloud-folder change to the task-links store must refresh the
  // Links column the same way calendar changes refresh the Calendar
  // screen. The watcher reports the store path (see watcher.ts); this
  // subscription scopes the refetch to that path so unrelated library
  // changes do not reload the links.
  useEffect(() => {
    if (!vault) return;
    const bridge = window.a11yNotebook?.vault;
    const unsubscribe = bridge?.onChanged?.((event) => {
      if (event.vaultPath !== vault.path) return;
      if (!event.paths.includes('.a11ynotebook/task-links.json')) return;
      void bridge
        .getTaskLinks?.()
        .then((items) => setTaskLinks(items))
        .catch(() => undefined);
    });
    return () => {
      unsubscribe?.();
    };
  }, [vault]);
  useEffect(() => {
    let cancelled = false;
    if (!vault) {
      setTags([]);
      return;
    }
    void window.a11yNotebook?.vault
      .getTags()
      .then((items) => {
        if (!cancelled) setTags(items);
      })
      .catch(() => setStatusMessage('Could not load tags.'));
    return () => {
      cancelled = true;
    };
  }, [vault]);

  useEffect(() => {
    let cancelled = false;
    if (activeDialog !== 'note-metadata') return;
    // Suggestions are an enhancement: without the index the dialog still edits.
    void window.a11yNotebook?.vault
      .getFrontMatterIndex?.()
      .then((index) => {
        if (!cancelled) setMetadataIndex(index);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [activeDialog]);

  useEffect(() => {
    let cancelled = false;
    if (!vault || !window.a11yNotebook) {
      setLinks([]);
      setBookmarks([]);
      return;
    }
    void Promise.all([window.a11yNotebook.vault.getLinkIndex(), window.a11yNotebook.vault.getBookmarks()])
      .then(([index, savedBookmarks]) => {
        if (cancelled) return;
        setLinks(index.links);
        setBookmarks(savedBookmarks);
      })
      .catch(() => setStatusMessage('Could not refresh library links and bookmarks.'));
    return () => {
      cancelled = true;
    };
  }, [vault]);

  useEffect(() => {
    try {
      window.localStorage.setItem('a11y-notebook.search-scope', searchScope);
    } catch {
      // Search scope is a UI preference; losing it is not an error.
    }
  }, [searchScope]);

  useEffect(() => {
    const bridge = window.a11yNotebook;
    const active = searchText.trim() || Object.values(searchFilters).some(Boolean);
    if (!bridge || !vault || !active) {
      setSearchResults([]);
      return;
    }
    if (searchScope === 'current' && !selectedNotebookPath) {
      setSearchResults([]);
      setStatusMessage('Select a notebook to search it, or switch search scope to Whole library.');
      return;
    }
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      const query: VaultSearchQuery =
        searchScope === 'current'
          ? { text: searchText, ...searchFilters, notebook: selectedNotebookPath, limit: 100 }
          : { text: searchText, ...searchFilters, limit: 100 };
      // The file index only knows file kinds: a task, reminder, or
      // appointment kind must never reach it (its validator rejects the
      // kind), so those searches skip the file query entirely.
      const fileKind =
        query.kind === 'task' || query.kind === 'reminder' || query.kind === 'appointment' ? null : query;
      void Promise.all([
        fileKind ? bridge.vault.search(fileKind) : Promise.resolve([] as VaultSearchResult[]),
        bridge.vault.getCalendar?.().catch(() => []) ?? Promise.resolve([]),
      ])
        .then(([fileMatches, appointments]) => {
          if (cancelled) return;
          const extra = searchTasksRemindersAppointments(query, {
            tasks,
            reminders: reminderState.reminders,
            appointments: appointments ?? [],
          });
          const matches = [...fileMatches, ...extra]
            .sort(
              (a, b) =>
                b.score - a.score ||
                a.path.localeCompare(b.path) ||
                a.kind.localeCompare(b.kind) ||
                (a.targetId ?? '').localeCompare(b.targetId ?? ''),
            )
            .slice(0, query.limit ?? 100);
          setSearchResults(matches);
          // The list itself is filtered at render, but the announcement
          // must count what is actually shown.
          const hidden = settings.showOriginalFiles
            ? new Set<string>()
            : supersededPaths(vault?.entries ?? []);
          const visible = matches.filter((match) => !hidden.has(match.path)).length;
          setStatusMessage(
            `${visible} search results shown in ${searchScope === 'current' ? 'the current notebook' : 'the whole library'}.`,
          );
        })
        .catch(() => {
          if (!cancelled) setStatusMessage('Could not query the search index.');
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [
    searchText,
    searchFilters,
    searchScope,
    selectedNotebookPath,
    vault,
    settings.showOriginalFiles,
    tasks,
    reminderState.reminders,
  ]);

  const availableRegions = FOCUS_REGION_ORDER.filter(
    (region) => (region !== 'right-pane' || rightPaneOpen) && (!focusMode || region === 'main'),
  );

  /** The element that receives focus when a region is entered. */
  const getFocusElement = useCallback(
    (target: FocusTarget): HTMLElement | null => {
      switch (target) {
        case 'search':
          return searchRef.current;
        case 'navigation':
          return navigationRef.current;
        case 'tabs':
          return tabRefs.current[selectedTab] ?? null;
        case 'main':
          return tabPanelRef.current;
        case 'right-pane':
          return rightPaneRef.current;
        case 'status':
          return statusRef.current;
      }
    },
    [selectedTab],
  );

  const focusNow = useCallback(
    (target: FocusTarget) => {
      // In Focus Mode only the document (and the search box, which is not a
      // region) stays visible; a request for a hidden region lands in the
      // document instead of on an element that cannot take focus.
      if (focusModeRef.current && target !== 'main' && target !== 'search') target = 'main';
      const element = getFocusElement(target);
      if (!element) {
        return false;
      }
      if (target === 'main' && document.activeElement === element) element.blur();
      element.focus();
      if (target !== 'search') {
        setActiveRegion(target);
      }
      return true;
    },
    [getFocusElement],
  );

  // Focus requests are applied after render so that targets which are about to
  // appear (such as the right pane) exist, and so they run after a closing dialog
  // has restored focus.
  useEffect(() => {
    if (pendingFocus) {
      focusNow(pendingFocus);
      setPendingFocus(null);
    }
  }, [pendingFocus, focusNow]);

  // A just-created note takes editor focus once it is actually in Editing
  // mode. Declared after the panel-focus effect above so it wins over the
  // tab-panel focus that opening a note requests. The pending request is
  // kept until the creation dialog has closed, because the dialog's own
  // focus restore runs when it unmounts and would otherwise steal the
  // editor focus back to the dialog's invoker.
  useEffect(() => {
    const pending = pendingEditorFocusRef.current;
    if (!pending) return;
    if (pending.path !== currentNoteId) {
      pendingEditorFocusRef.current = null;
      return;
    }
    if (mode !== 'edit' || !editorRef.current) return;
    editorRef.current.focus();
    if (pending.cursor !== undefined) {
      editorRef.current.setSelectionRange(pending.cursor, pending.cursor);
      noteCaretRef.current[pending.path] = { start: pending.cursor, end: pending.cursor };
    }
    if (!itemDialog && !activeDialog) pendingEditorFocusRef.current = null;
  }, [mode, currentNoteId, itemDialog, activeDialog]);

  // After closing a note or file, focus returns to the Notes and Files grid —
  // to the closed item's cell when it is still listed, otherwise to the grid's
  // active cell. Runs after render so the grid exists.
  useEffect(() => {
    if (pendingGridFocusPath === undefined || selectedTab !== 'notes-files') return;
    const panel = tabPanelRef.current;
    const cells = panel ? Array.from(panel.querySelectorAll<HTMLElement>('[role="grid"] [role="gridcell"]')) : [];
    const target =
      cells.find((cell) => cell.dataset.path === pendingGridFocusPath && cell.getAttribute('aria-colindex') === '1') ??
      cells.find((cell) => cell.tabIndex === 0) ??
      panel;
    if (target) {
      target.focus();
      setActiveRegion('main');
    }
    setPendingGridFocusPath(undefined);
  }, [pendingGridFocusPath, selectedTab]);

  // After closing a library, focus lands on the Libraries grid itself, not
  // on the Notes and Files view the app used to return to.
  useEffect(() => {
    if (!pendingLibraryGridFocus || selectedTab !== 'libraries') return;
    const panel = tabPanelRef.current;
    const target = panel?.querySelector<HTMLElement>('[role="grid"] [role="gridcell"]') ?? panel;
    if (target) {
      target.focus();
      setActiveRegion('main');
    }
    setPendingLibraryGridFocus(false);
  }, [pendingLibraryGridFocus, selectedTab]);

  // After opening a library, focus lands in the Notebooks grid of the
  // opened library. The target is the grid's first column header, not a
  // body cell: DetailsView selects a notebook when its cell receives
  // focus, which would undo the cleared notebook context a library open
  // is supposed to leave behind, while header focus never selects
  // anything and ArrowDown from the header enters the first row. If the
  // open lands anywhere else (for example the restored last notebook's
  // view), the request does not apply and the flag is dropped instead
  // of yanking focus later. While the library is still switching, the
  // "Opening library" dialog is mounted and its focus trap would yank
  // focus back into the dialog, after which closing the dialog drops
  // focus to the body; so the request waits, without being dropped,
  // until the switch (and the dialog) is finished.
  useEffect(() => {
    if (!pendingNotebooksGridFocus) return;
    if (switchingVault) return;
    if (selectedTab !== 'notebooks') {
      setPendingNotebooksGridFocus(false);
      return;
    }
    const panel = tabPanelRef.current;
    const target = panel?.querySelector<HTMLElement>('[role="grid"] [role="columnheader"]') ?? panel;
    if (target) {
      target.focus();
      setActiveRegion('main');
    }
    setPendingNotebooksGridFocus(false);
  }, [pendingNotebooksGridFocus, selectedTab, switchingVault]);

  // Auto-focus on grids: when the setting is on, switching to a grid
  // view lands keyboard focus in the grid itself, so screen reader
  // users do not have to find and enter it by hand. The first render
  // is not a switch, so opening the app never steals focus, and
  // toggling the setting on while already in a grid view does not
  // yank focus either. Dialogs block the move.
  const previousTabForGridFocusRef = useRef(selectedTab);
  useEffect(() => {
    const previousTab = previousTabForGridFocusRef.current;
    previousTabForGridFocusRef.current = selectedTab;
    if (previousTab === selectedTab) return;
    if (!settings.autoFocusGridsOnViewSwitch) return;
    if (selectedTab !== 'libraries' && selectedTab !== 'notebooks' && selectedTab !== 'notes-files') return;
    if (activeDialog || itemDialog) return;
    const target = findGridFocusTarget(tabPanelRef.current);
    if (target) {
      target.focus();
      setActiveRegion('main');
    }
  }, [selectedTab, settings.autoFocusGridsOnViewSwitch, activeDialog, itemDialog]);

  // Keep the highlighted region in sync when focus moves by mouse or Tab.
  useEffect(() => {
    const containers: [FocusRegion, RefObject<HTMLElement>][] = [
      ['navigation', navigationRef],
      ['tabs', tabListRef],
      ['main', tabPanelRef],
      ['right-pane', rightPaneRef],
      ['status', statusRef],
    ];
    const handleFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      const match = containers.find(([, ref]) => ref.current?.contains(target));
      if (match) {
        setActiveRegion(match[0]);
      }
    };
    document.addEventListener('focusin', handleFocusIn);
    return () => document.removeEventListener('focusin', handleFocusIn);
  }, []);

  // On first open, give the window a focused element. With focus left on
  // the body, JAWS reads the whole window top to bottom on open; that
  // started with the 1.9.1 landmark change, which altered what JAWS sees
  // at startup. Focusing the selected tab button announces one element
  // instead. Runs once, only while focus is still on the body and no
  // dialog is open, so it never steals focus from a dialog, a click, or
  // a later focus request.
  const initialFocusTakenRef = useRef(false);
  useEffect(() => {
    if (initialFocusTakenRef.current) return;
    if (document.activeElement && document.activeElement !== document.body) return;
    if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
    const button = tabRefs.current[selectedTab];
    if (!button) return;
    initialFocusTakenRef.current = true;
    button.focus();
  }, [selectedTab]);

  // Show the guided tour the first time the app runs after an install or
  // an update, unless the user checked "Don't show this again". The tour
  // waits until no library switch, lock prompt, or password dialog is in
  // flight, so it never stacks on top of another dialog.
  const tutorialDecidedRef = useRef(false);
  useEffect(() => {
    if (tutorialDecidedRef.current) return;
    if (switchingVault || securityLocked || notePasswordDialog) return;
    tutorialDecidedRef.current = true;
    const state = readTutorialState();
    if (state.suppressed) return;
    if (state.lastVersionSeen !== __APP_VERSION__) {
      setTutorialOpen(true);
    }
    writeTutorialState({ suppressed: false, lastVersionSeen: __APP_VERSION__ });
  }, [switchingVault, securityLocked, notePasswordDialog]);

  // If the right pane is hidden while it contains focus, keep focus in the workspace.
  useEffect(() => {
    if (!rightPaneOpen && activeRegion === 'right-pane') {
      if (!document.activeElement || document.activeElement === document.body) {
        setPendingFocus('main');
      } else {
        setActiveRegion('main');
      }
    }
  }, [rightPaneOpen, activeRegion]);

  // Focus Mode ends the moment the focused document stops being the active
  // tab: switching to another view, closing the active note (which returns
  // to the Notes and Files grid), or opening a non-document screen. Opening
  // a different note keeps Focus Mode, because the document view continues.
  useEffect(() => {
    if (focusMode && !openNotes.some((note) => note.id === selectedTab)) {
      setFocusMode(false);
    }
  }, [focusMode, selectedTab, openNotes]);

  const regionContaining = (element: Element | null): FocusRegion | null => {
    if (!element) {
      return null;
    }
    if (navigationRef.current?.contains(element)) return 'navigation';
    if (tabListRef.current?.contains(element)) return 'tabs';
    if (tabPanelRef.current?.contains(element)) return 'main';
    if (rightPaneRef.current?.contains(element)) return 'right-pane';
    if (statusRef.current?.contains(element)) return 'status';
    return null;
  };

  const checkForUpdates = () => {
    setActiveDialog('updates');
    updater.check();
  };

  const selectEntry = (entry: VaultEntry) => {
    setTreeSelection(entry.path);
    if (entry.kind === 'notebook') setSelectedNotebookPath(entry.path);
  };

  /** Open a standalone link in the default browser (never inside a note). */
  const openLinkEntry = async (entry: VaultEntry) => {
    const bridge = window.a11yNotebook;
    if (!bridge) return;
    try {
      const preview = await bridge.vault.readAttachment(entry.path);
      const url = parseLinkUrl(preview.text ?? '');
      if (!url || !isAllowedLinkUrl(url)) {
        setStatusMessage('This link has no usable web address. Edit the link to fix the address.');
        return;
      }
      await bridge.vault.openUrl(url);
      setStatusMessage(`Opened ${entry.name} in the default browser.`);
    } catch {
      setStatusMessage('Could not open this link.');
    }
  };

  /** Open the edit dialog for a link, reading its current address from the file. */
  const openEditLinkDialog = async (entry: VaultEntry) => {
    const bridge = window.a11yNotebook?.vault;
    if (!bridge) return;
    try {
      const preview = await bridge.readAttachment(entry.path);
      const url = parseLinkUrl(preview.text ?? '') ?? '';
      setLinkDialog({ mode: 'edit', path: entry.path, title: entry.name.replace(/\.url$/i, ''), url });
    } catch {
      setStatusMessage('Could not read this link.');
    }
  };

  /** The notebook a new grid item goes into: the selected notebook, or the open Notes & Files notebook. */
  const linkTargetNotebook = (): string | undefined => {
    const selectedEntry = findEntry(vault?.entries ?? [], treeSelection);
    if (selectedEntry?.kind === 'notebook') return selectedEntry.path;
    if (selectedTab === 'notes-files') return selectedNotebookPath || undefined;
    return undefined;
  };

  const openEntry = async (
    entry: VaultEntry,
    notePassword?: string,
    canContinue: () => boolean = () => true,
    onOpened?: () => void,
  ) => {
    const bridge = window.a11yNotebook;
    if (!bridge || switchingRef.current || securityLockedRef.current || !canContinue()) return;
    const root = vaultPathRef.current;
    const generation = vaultGenerationRef.current;
    const canOpen = () =>
      !switchingRef.current &&
      !securityLockedRef.current &&
      vaultPathRef.current === root &&
      vaultGenerationRef.current === generation &&
      canContinue();
    selectEntry(entry);
    if (entry.kind === 'link') {
      await openLinkEntry(entry);
      return;
    }
    if (entry.kind !== 'notebook' && !isManagedEntry(entry)) {
      const encryptedLegacy =
        entry.kind === 'note' &&
        !assetRegistry.resolve(entry.path) &&
        (await bridge.vault.isNoteEncrypted?.(entry.path));
      if (!canOpen()) return;
      if (encryptedLegacy) {
        if (!bridge.vault.adoptEncrypted) {
          setStatusMessage(
            'Legacy encrypted-note recovery is unavailable. Keep the original encrypted file unchanged.',
          );
          return;
        }
        let adopted: VaultInfo | null;
        try {
          adopted = await bridge.vault.adoptEncrypted(entry.path, notePassword);
        } catch (failure) {
          if (!canOpen()) return;
          if (!notePassword && failure instanceof Error && /note’s password/i.test(failure.message)) {
            setNotePasswordDialog({ action: 'unlock', entry });
            return;
          }
          throw failure;
        }
        if (!canOpen() || !adopted) return;
        const recovered = findEntry(adopted.entries, entry.path);
        if (!recovered || recovered.kind !== 'note' || !isManagedEntry(recovered))
          throw new Error('Encrypted-note authentication did not establish a managed recovery entry.');
        setVault(adopted);
        await openEntry(recovered, notePassword, canContinue, onOpened);
        return;
      }
      // Every entry that reaches this opener already lives inside the
      // library, so a missing origin record must not prompt: records
      // predate the provenance system, and cloud sync can replace a
      // file and drop its identity. Unsupported files still prompt
      // below; legacy encrypted notes were handled above.
      if (!isInternallySupportedPath(entry.path)) {
        setExternalFile(entry);
        return;
      }
    }
    if (entry.kind !== 'notebook' && !isInternallySupportedPath(entry.path)) {
      setExternalFile(entry);
      return;
    }
    // CSV files always open in the spreadsheet view, even though the Grid
    // cognitive tool also claims the .csv extension: Grid files stay
    // openable from the Assets tab, where readAsset resolves them by type.
    if (!/\.csv$/i.test(entry.path) && assetRegistry.resolve(entry.path)) {
      if (assetDirty || assetBusy) {
        setStatusMessage('Save cognitive asset changes and wait for pending operations before opening another asset.');
        return;
      }
      setAssetInitialPath(entry.path);
      setAssetSelectionVersion((version) => version + 1);
      setAssetTabOpen(true);
      setSelectedTab('assets');
      setPendingFocus('main');
      return;
    }
    if (entry.kind === 'attachment') {
      if (/\.(?:txt|csv|html?|pdf|epub|docx|rtf|doc|xlsx|ods|xls|pptx|odp)$/i.test(entry.path)) {
        const preview = await bridge.vault.readAttachment(entry.path);
        if (!canOpen()) return;
        setAttachment(preview);
        setSelectedTab('attachment');
      } else if (/\.(?:png|jpe?g|gif|webp|bmp)$/i.test(entry.path)) {
        const alt = await bridge.vault.getImageAlt(entry.path);
        if (!canOpen()) return;
        setImageAlt(alt);
        setAttachment({ path: entry.path, text: '', kind: 'image' });
        setSelectedTab('attachment');
      } else if (isAudioPath(entry.path)) {
        if (!canOpen()) return;
        setAttachment({
          path: entry.path,
          text: '',
          kind: entry.path.slice(entry.path.lastIndexOf('.')).toLowerCase(),
        });
        setSelectedTab('attachment');
      } else {
        setStatusMessage('This attachment has no in-app preview yet. Opening in the external app.');
        await bridge.vault.openExternal(entry.path);
      }
      return;
    }
    if (entry.kind !== 'note') return;
    const existingNote = openNotes.find((item) => item.id === entry.path);
    if (existingNote) {
      onOpened?.();
      // Selecting an already-open note keeps its mode, like switching to
      // its tab: the mode effect restores the remembered mode (or the
      // default when there is none) and enforces read-only for locks.
      setSelectedTab(existingNote.id);
      setPendingFocus('main');
      return;
    }
    let content: string;
    try {
      const loaded = await bridge.vault.readNote(entry.path, notePassword);
      content = /\.html?$/i.test(entry.path) ? sanitizeNoteHtml(loaded, entry.path) : loaded;
    } catch (error) {
      if (!canOpen()) return;
      if (!notePassword && error instanceof Error && /note’s password/i.test(error.message)) {
        setNotePasswordDialog({ action: 'unlock', entry });
        return;
      }
      throw error;
    }
    if (!canOpen()) return;
    const note: OpenNote = {
      id: entry.path,
      path: entry.path,
      title: entry.name.replace(/\.(?:md|html|htm|txt)$/i, ''),
      content,
      saved: content,
    };
    setOpenNotes((current) =>
      current.some((item) => item.id === note.id)
        ? current.map((item) => (item.id === note.id ? note : item))
        : [...current, note],
    );
    setSelectedTab(note.id);
    setMode(settings.defaultNoteOpenMode === 'edit' ? 'edit' : 'read-only');
    setPendingFocus('main');
    onOpened?.();
    setNotePasswordDialog(null);
  };

  const importInternalEntry = async (entry: VaultEntry) => {
    const bridge = window.a11yNotebook?.vault;
    if (!bridge?.importEntry || securityLocked || switchingRef.current)
      throw new Error('Open and unlock a library before importing.');
    const root = vaultPathRef.current;
    const generation = externalOperationGeneration.current;
    const imported = await bridge.importEntry(entry.path);
    const isCurrent = () =>
      generation === externalOperationGeneration.current && vaultPathRef.current === root && !switchingRef.current;
    if (!isCurrent() || !imported) return;
    if (imported.vault.path !== root) throw new Error('The library changed during import.');
    const copy = findEntry(imported.vault.entries, imported.path);
    if (!copy || copy.provenance !== 'imported')
      throw new Error('The imported copy is unavailable. Refresh the library before opening it.');
    setVault(imported.vault);
    await openEntry(copy, undefined, isCurrent);
    if (isCurrent()) setStatusMessage(`Imported ${entry.name} as ${copy.name}.`);
  };

  const [reminderCreateRequest, setReminderCreateRequest] = useState(0);
  const [reminderCreatePath, setReminderCreatePath] = useState<string | undefined>(undefined);
  const [calendarCreateRequest, setCalendarCreateRequest] = useState(0);
  // A stale create request must not reopen a cancelled dialog when its
  // view remounts: leaving the calendar or reminders view consumes the
  // request, so returning later starts clean. (Opening a create dialog
  // from elsewhere sets the tab and increments in the same render, so
  // the effect below never clears a request that was just issued.)
  useEffect(() => {
    if (selectedTab !== 'calendar') setCalendarCreateRequest(0);
  }, [selectedTab]);
  useEffect(() => {
    if (selectedTab !== 'reminders') setReminderCreateRequest(0);
  }, [selectedTab]);
  const openCreateReminder = (path?: string) => {
    if (!vault || securityLocked) {
      setStatusMessage('Open and unlock a library before creating a reminder.');
      return;
    }
    setSelectedTab('reminders');
    // A path from the context menu pre-selects that note or file in the
    // dialog; any other entry point clears a stale one.
    setReminderCreatePath(path);
    setReminderCreateRequest((value) => value + 1);
  };

  const createNote = async () => {
    if (!vault || !window.a11yNotebook) {
      setStatusMessage('Open a library before creating a note.');
      return;
    }
    if (selectedTab === 'notes-files' && !selectedNotebookPath) {
      setStatusMessage('Select a notebook before creating a note.');
      return;
    }
    if (switchingRef.current || securityLockedRef.current) return;
    if (assetDirty || assetBusy) {
      setStatusMessage('Save cognitive asset changes and wait for pending operations before creating a note.');
      return;
    }
    setItemDialog({ action: 'new-note', path: selectedNotebookPath });
  };

  const createTask = async (path: string, text: string, due: string, priority: string, reminder = '') => {
    if (!vault || switchingRef.current || securityLocked || taskCreating) return;
    const root = vault.path;
    const generation = vaultGenerationRef.current;
    const isCurrent = () =>
      !switchingRef.current &&
      !securityLockedRef.current &&
      vaultPathRef.current === root &&
      vaultGenerationRef.current === generation;
    const bridge = window.a11yNotebook!.vault;
    setTaskCreating(true);
    setTaskCreateError('');
    try {
      if (!notePaths.includes(path)) throw new Error('Choose a managed note, not an external file or cognitive asset.');
      if (openNotes.some((note) => note.path === path && note.content !== note.saved) || activeConflict)
        throw new Error('Save or resolve note changes before adding a task.');
      if (await bridge.isNoteEncrypted?.(path))
        throw new Error('Add tasks to an unencrypted note so they can appear in Tasks.');
      const baseline = await bridge.readNote(path);
      let content: string;
      if (/\.html?$/i.test(path)) {
        const document = new DOMParser().parseFromString(baseline, 'text/html');
        const list = document.createElement('ul');
        const item = document.createElement('li');
        item.setAttribute('data-a11y-task-id', crypto.randomUUID());
        item.setAttribute('data-a11y-task-complete', 'false');
        if (due) item.setAttribute('data-a11y-task-due', due);
        if (reminder) item.setAttribute('data-a11y-task-remind', reminder.replace('T', ' '));
        item.setAttribute('data-a11y-task-priority', priority);
        item.textContent = text;
        list.append(item);
        document.body.append(list);
        content = sanitizeNoteHtml(document.body.innerHTML, path);
      } else {
        const description = text.replace(/[\r\n]+/g, ' ');
        const reminderSuffix = reminder ? ` remind:${reminder.replace('T', ' ')}` : '';
        content = `${baseline}${baseline.endsWith('\n') || !baseline ? '' : '\n'}- [ ] ${description}${due ? ` due:${due}` : ''} priority:${priority}${reminderSuffix} <!-- a11y-task-id:${crypto.randomUUID()} -->\n`;
      }
      if (!isCurrent()) return;
      await bridge.saveNote(path, content, baseline);
      if (!isCurrent()) return;
      // Record the insertion in the fallback history so adding a task
      // can be undone like any other edit; then mark it saved.
      updateNoteContent(path, content, 'edit');
      setOpenNotes((items) => items.map((note) => (note.path === path ? { ...note, saved: content } : note)));
      setTaskDialogOpen(false);
      setTaskTabOpen(true);
      setSelectedTab('tasks');
      setPendingFocus('main');
      setStatusMessage('Task created in its associated note.');
      try {
        const refreshedTasks = await bridge.getTasks();
        if (isCurrent()) setTasks(refreshedTasks);
      } catch {
        if (isCurrent()) setStatusMessage('Task created. Refresh Tasks to update the list.');
      }
    } catch (failure) {
      setTaskCreateError((failure as Error).message);
    } finally {
      setTaskCreating(false);
    }
  };

  const saveTaskSchedule = async (task: VaultTask, schedule: TaskSchedule) => {
    if (!window.a11yNotebook) return;
    if (task.htmlTask) {
      if (!window.a11yNotebook.vault.setHtmlTaskSchedule) {
        throw new Error('This build does not support setting a task schedule.');
      }
      const updated = await window.a11yNotebook.vault.setHtmlTaskSchedule(
        task.path,
        task.taskId!,
        schedule,
        task.revision!,
      );
      setTasks(updated);
      const note = openNotes.find((item) => item.path === task.path);
      if (note) {
        const content = await window.a11yNotebook.vault.readNote(task.path);
        // Record the schedule change in the fallback history so it can
        // be undone; then mark it saved.
        updateNoteContent(note.id, content, 'edit');
        setOpenNotes((items) =>
          items.map((item) => (item.id === note.id ? { ...item, saved: content } : item)),
        );
      }
      setStatusMessage('Task due date updated.');
      return;
    }
    const source = await window.a11yNotebook.vault.readNote(task.path);
    if (!task.line) return;
    const lines = source.split(/\r?\n/);
    const line = lines[task.line - 1];
    if (!line) return;
    lines[task.line - 1] = updateMarkdownTaskLine(line, { schedule });
    await window.a11yNotebook.vault.saveNote(task.path, lines.join('\n'), source);
    setTasks(await window.a11yNotebook.vault.getTasks());
    setStatusMessage('Task due date updated.');
  };

  const saveTaskPriority = async (task: VaultTask, priority: string) => {
    if (!window.a11yNotebook) return;
    if (task.htmlTask) {
      if (!window.a11yNotebook.vault.setHtmlTaskPriority) {
        throw new Error('This build does not support setting a task priority.');
      }
      const updated = await window.a11yNotebook.vault.setHtmlTaskPriority(
        task.path,
        task.taskId!,
        priority,
        task.revision!,
      );
      setTasks(updated);
      const note = openNotes.find((item) => item.path === task.path);
      if (note) {
        const content = await window.a11yNotebook.vault.readNote(task.path);
        // Record the priority change in the fallback history so it can
        // be undone; then mark it saved.
        updateNoteContent(note.id, content, 'edit');
        setOpenNotes((items) =>
          items.map((item) => (item.id === note.id ? { ...item, saved: content } : item)),
        );
      }
      setStatusMessage('Task priority updated.');
      return;
    }
    const source = await window.a11yNotebook.vault.readNote(task.path);
    if (!task.line) return;
    const lines = source.split(/\r?\n/);
    const line = lines[task.line - 1];
    if (!line) return;
    lines[task.line - 1] = updateMarkdownTaskLine(line, { priority });
    await window.a11yNotebook.vault.saveNote(task.path, lines.join('\n'), source);
    setTasks(await window.a11yNotebook.vault.getTasks());
    setStatusMessage('Task priority updated.');
  };

  const saveTaskLink = async (task: VaultTask, kind: TaskLinkKind, target: string) => {
    if (!window.a11yNotebook?.vault.saveTaskLinks) {
      throw new Error('This build does not support task links.');
    }
    const link: TaskLink = {
      id: `link-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      taskId: task.id,
      taskPath: task.path,
      kind,
      target,
    };
    const next = [...taskLinks.filter((item) => item.id !== link.id), link];
    setTaskLinks(await window.a11yNotebook.vault.saveTaskLinks(next));
    setStatusMessage(`Task linked to ${target}.`);
  };

  const removeTaskLink = async (link: TaskLink) => {
    if (!window.a11yNotebook?.vault.saveTaskLinks) return;
    setTaskLinks(
      await window.a11yNotebook.vault.saveTaskLinks(taskLinks.filter((item) => item.id !== link.id)),
    );
    if (link.auto) {
      // Removing an auto-link is a choice the next refresh must respect,
      // not a gap for reconciliation to fill back in.
      const dismissed = [...new Set([...dismissedTaskAutoLinks, link.taskId])];
      setDismissedTaskAutoLinks(dismissed);
      const saved = window.a11yNotebook.vault.saveDismissedTaskAutoLinks?.(dismissed);
      if (saved) await saved.catch(() => undefined);
    }
    setStatusMessage(`Link to ${link.target} removed.`);
  };

  const openTaskLink = async (link: TaskLink) => {
    const entry = findEntry(vault?.entries ?? [], link.target);
    if (!entry) {
      // The target is gone: drop the dead link instead of leaving it
      // displayed, and say so — opening it again must not repeat the
      // "no longer in the library" message.
      if (window.a11yNotebook?.vault.saveTaskLinks) {
        await removeTaskLink(link);
        setStatusMessage(`The linked ${link.kind} is no longer in the library, so its link was removed.`);
      } else {
        setStatusMessage(`The linked ${link.kind} is no longer in the library.`);
      }
      return;
    }
    if (link.kind === 'notebook') {
      setSelectedNotebookPath(link.target);
      setSelectedTab('notes-files');
      return;
    }
    await openEntry(entry);
  };

  const savePriorityOptions = async (options: string[]) => {
    if (!window.a11yNotebook) return;
    const next = { ...settings, priorityOptions: options };
    await persistSettings(next);
  };

  const [spellingOpen, setSpellingOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  // The last search term survives the dialog closing so F3 can repeat it.
  const findQueryRef = useRef<{ query: string; caseSensitive: boolean } | null>(null);
  // The match position is per document: a new document starts fresh.
  const findPositionRef = useRef<{ docKey: string; position: number } | null>(null);
  // The element Find last made focusable to land on a match, so its
  // temporary tab stop can be removed when the next match takes over.
  const findFocusElRef = useRef<HTMLElement | null>(null);
  const findFocusSetRef = useRef(false);
  /**
   * Focus a rendered match's containing element. A DOM selection alone
   * does not move a screen reader's reading position, so the element
   * itself takes focus (gaining a temporary tab stop only when it has
   * none). Returns false when there is no element to focus.
   */
  const focusDomMatch = (matches: readonly { node: Text }[], position: number): boolean => {
    const match = matches[position];
    const element = match?.node.parentElement;
    if (!element) return false;
    const previous = findFocusElRef.current;
    if (previous && previous !== element && previous.isConnected && findFocusSetRef.current) {
      previous.removeAttribute('tabindex');
    }
    findFocusElRef.current = element;
    findFocusSetRef.current = false;
    if (!element.hasAttribute('tabindex')) {
      element.tabIndex = -1;
      findFocusSetRef.current = true;
    }
    element.focus();
    return true;
  };
  const attachmentRef = useRef<HTMLDivElement>(null);

  const isReaderAttachment = (path: string) => /\.(?:pdf|epub|docx)$/i.test(path);
  const isImageAttachment = (path: string) => /\.(?:png|jpe?g|gif|webp|bmp)$/i.test(path);

  /** Advance a match position with wrap-around; an out-of-range position restarts. */
  const advanceFindPosition = (total: number, position: number, direction: 'next' | 'prev'): number => {
    if (position < 0 || position >= total) return direction === 'next' ? 0 : total - 1;
    if (direction === 'next') return position < total - 1 ? position + 1 : 0;
    return position > 0 ? position - 1 : total - 1;
  };

  /** Search the rendered text under root and select the next or previous match. */
  const searchDomRoot = (
    root: HTMLElement,
    docKey: string,
    query: string,
    direction: 'next' | 'prev',
    caseSensitive: boolean,
    moveFocus = false,
  ): string => {
    const matches = findDomMatches(root, query, caseSensitive);
    if (!matches.length) {
      findPositionRef.current = null;
      window.getSelection()?.removeAllRanges();
      return `No matches for "${query}".`;
    }
    const stored = findPositionRef.current;
    const position = advanceFindPosition(
      matches.length,
      stored && stored.docKey === docKey ? stored.position : -1,
      direction,
    );
    selectDomMatch(matches, position);
    findPositionRef.current = { docKey, position };
    // Edit mode focuses the textarea itself; the rendered document needs
    // the same treatment, or a repeat selects a match the keyboard focus
    // never follows. So the repeat path focuses the match's own element,
    // not just the panel around it. Only the dialog-closed repeat path
    // moves focus: while the Find dialog is open, its focus trap owns it.
    if (moveFocus) {
      if (focusDomMatch(matches, position)) {
        // Focusing an element can drop the selection, so re-select the
        // match after focus lands: both must be true at once.
        selectDomMatch(matches, position);
      } else {
        tabPanelRef.current?.focus();
      }
      setActiveRegion('main');
    }
    return `Match ${position + 1} of ${matches.length} for "${query}".`;
  };

  /**
   * Search the active document and move to the next or previous match.
   * Notes search the editor selection in edit mode and the rendered
   * document in reading mode. Text and CSV attachments search their
   * rendered preview; HTML attachments can only be counted, because
   * their preview is a sandboxed frame the app cannot select inside.
   * Returns the status text the Find dialog announces.
   */
  const searchDocument = (
    query: string,
    direction: 'next' | 'prev',
    caseSensitive: boolean,
    moveFocus = false,
  ): string => {
    if (!query) return 'Enter text to find.';
    findQueryRef.current = { query, caseSensitive };
    if (selectedTab === 'attachment' && attachment) {
      if (isImageAttachment(attachment.path)) return 'This image has no text to search.';
      if (isReaderAttachment(attachment.path)) return 'This document has its own search box.';
      if (/\.html?$/i.test(attachment.path)) {
        const template = document.createElement('template');
        template.innerHTML = attachment.text;
        const text = template.content.textContent ?? '';
        const matches = findAllMatches(text, query, caseSensitive);
        if (!matches.length) {
          findPositionRef.current = null;
          return `No matches for "${query}".`;
        }
        const docKey = `attachment:${attachment.path}`;
        const stored = findPositionRef.current;
        const position = advanceFindPosition(
          matches.length,
          stored && stored.docKey === docKey ? stored.position : -1,
          direction,
        );
        findPositionRef.current = { docKey, position };
        return `Match ${position + 1} of ${matches.length} for "${query}".`;
      }
      const root = attachmentRef.current;
      if (!root) return 'The document is not displayed.';
      return searchDomRoot(root, `attachment:${attachment.path}`, query, direction, caseSensitive, moveFocus);
    }
    if (!currentNote) return 'Open a note or document to search within it.';
    if (mode === 'edit') {
      const textarea = editorRef.current;
      const text = textarea?.value ?? currentNote.content;
      const matches = findAllMatches(text, query, caseSensitive);
      if (!matches.length) {
        findPositionRef.current = null;
        return `No matches for "${query}".`;
      }
      const docKey = `note:${currentNote.id}:${mode}`;
      const stored = findPositionRef.current;
      const position = advanceFindPosition(
        matches.length,
        stored && stored.docKey === docKey ? stored.position : -1,
        direction,
      );
      const match = matches[position];
      if (!match) return `No matches for "${query}".`;
      if (textarea) {
        textarea.focus();
        textarea.setSelectionRange(match.index, match.index + match.length);
        noteCaretRef.current[currentNote.id] = { start: match.index, end: match.index + match.length };
      }
      findPositionRef.current = { docKey, position };
      return `Match ${position + 1} of ${matches.length} for "${query}".`;
    }
    const root = annotationTools.documentRef.current;
    if (!root) return 'The note is not displayed.';
    return searchDomRoot(root, `note:${currentNote.id}:${mode}`, query, direction, caseSensitive, moveFocus);
  };

  /**
   * Start finding in the active document. PDF, ePub, and DOCX readers
   * have their own search boxes, so Ctrl+F focuses the box instead of
   * opening the Find dialog. Images have no text to search.
   */
  const startFind = () => {
    if (selectedTab === 'attachment' && attachment) {
      if (isImageAttachment(attachment.path)) {
        setStatusMessage('This image has no text to search.');
        return;
      }
      if (isReaderAttachment(attachment.path)) {
        const root = attachmentRef.current;
        if (root && focusReaderSearchBox(root)) return;
        setStatusMessage('The document search is not ready yet.');
        return;
      }
      setFindOpen(true);
      return;
    }
    if (currentNote) {
      setFindOpen(true);
      return;
    }
    setStatusMessage('Open a note or document to search within it.');
  };

  /**
   * All matches of a query as context snippets, for the Find dialog's
   * match list. Notes in edit mode search the editor text; notes in
   * reading mode and text attachments search the rendered document's
   * text nodes, with the snippet taken from the match's own node (a
   * paragraph is normally one node, so the surrounding words are
   * there). HTML attachments search the extracted text only, since
   * their preview frame cannot be selected inside; reader documents
   * have their own search box and are not listed here.
   */
  const listFindMatches = (query: string, caseSensitive: boolean): string[] => {
    if (!query) return [];
    if (selectedTab === 'attachment' && attachment) {
      if (isImageAttachment(attachment.path) || isReaderAttachment(attachment.path)) return [];
      if (/\.html?$/i.test(attachment.path)) {
        const template = document.createElement('template');
        template.innerHTML = attachment.text;
        return findMatchSnippets(template.content.textContent ?? '', query, caseSensitive);
      }
      const root = attachmentRef.current;
      if (!root) return [];
      return findDomMatches(root, query, caseSensitive).map((match) =>
        matchSnippet(match.node.data, { index: match.start, length: match.length }),
      );
    }
    if (!currentNote) return [];
    if (mode === 'edit') {
      const text = editorRef.current?.value ?? currentNote.content;
      return findMatchSnippets(text, query, caseSensitive);
    }
    const root = annotationTools.documentRef.current;
    if (!root) return [];
    return findDomMatches(root, query, caseSensitive).map((match) =>
      matchSnippet(match.node.data, { index: match.start, length: match.length }),
    );
  };

  /**
   * Move to one listed match by position. The dialog closes after this
   * (the caller handles that when moved is true), and the existing
   * Find-close effect then puts focus in the document at the stored
   * match; edit mode also selects the match text before closing, so
   * focus lands on it. Returns moved false, keeping the dialog open,
   * when the match cannot be moved to from here.
   */
  const jumpToFindMatch = (position: number): FindMatchJump => {
    const storedQuery = findQueryRef.current;
    if (!storedQuery) return { status: 'No previous search. Open Find first.', moved: false };
    const { query, caseSensitive } = storedQuery;
    if (selectedTab === 'attachment' && attachment) {
      if (isImageAttachment(attachment.path)) {
        return { status: 'This image has no text to search.', moved: false };
      }
      if (isReaderAttachment(attachment.path)) {
        return { status: 'This document has its own search box.', moved: false };
      }
      if (/\.html?$/i.test(attachment.path)) {
        return { status: 'This preview cannot be moved to from here.', moved: false };
      }
      const root = attachmentRef.current;
      if (!root) return { status: 'The document is not displayed.', moved: false };
      const matches = findDomMatches(root, query, caseSensitive);
      if (position < 0 || position >= matches.length) {
        return { status: `No matches for "${query}".`, moved: false };
      }
      selectDomMatch(matches, position);
      findPositionRef.current = { docKey: `attachment:${attachment.path}`, position };
      return { status: `Match ${position + 1} of ${matches.length} for "${query}".`, moved: true };
    }
    if (!currentNote) {
      return { status: 'Open a note or document to search within it.', moved: false };
    }
    if (mode === 'edit') {
      const textarea = editorRef.current;
      const text = textarea?.value ?? currentNote.content;
      const matches = findAllMatches(text, query, caseSensitive);
      const match = matches[position];
      if (!match) return { status: `No matches for "${query}".`, moved: false };
      if (textarea) {
        textarea.setSelectionRange(match.index, match.index + match.length);
        noteCaretRef.current[currentNote.id] = { start: match.index, end: match.index + match.length };
      }
      findPositionRef.current = { docKey: `note:${currentNote.id}:${mode}`, position };
      return { status: `Match ${position + 1} of ${matches.length} for "${query}".`, moved: true };
    }
    const root = annotationTools.documentRef.current;
    if (!root) return { status: 'The note is not displayed.', moved: false };
    const matches = findDomMatches(root, query, caseSensitive);
    if (position < 0 || position >= matches.length) {
      return { status: `No matches for "${query}".`, moved: false };
    }
    selectDomMatch(matches, position);
    findPositionRef.current = { docKey: `note:${currentNote.id}:${mode}`, position };
    return { status: `Match ${position + 1} of ${matches.length} for "${query}".`, moved: true };
  };

  /**
   * Repeat the last search after the Find dialog closed (F3 / Shift+F3).
   * Reader documents just refocus their search box; other documents
   * search with the stored term. Returns the status text, or undefined
   * when focus itself is the feedback.
   */
  const repeatFind = (direction: 'next' | 'prev'): string | undefined => {
    const stored = findQueryRef.current;
    if (!stored) return 'No previous search. Open Find first.';
    if (selectedTab === 'attachment' && attachment && isReaderAttachment(attachment.path)) {
      const root = attachmentRef.current;
      if (root && focusReaderSearchBox(root)) return undefined;
      return 'The document search is not ready yet.';
    }
    return searchDocument(stored.query, direction, stored.caseSensitive, true);
  };

  /**
   * Closing Find leaves focus in the document at the match, so the
   * context around it can be read and repeats start from there. The
   * dialog's own focus restore stands when no match is selected. This
   * runs after the dialog unmounts, so it wins over that restore.
   */
  useEffect(() => {
    if (findOpen) return;
    const stored = findPositionRef.current;
    const query = findQueryRef.current;
    if (!stored || !query) return;
    if (selectedTab === 'attachment' && attachment) {
      if (stored.docKey !== `attachment:${attachment.path}`) return;
      const root = attachmentRef.current;
      if (!root) return;
      const matches = findDomMatches(root, query.query, query.caseSensitive);
      if (focusDomMatch(matches, stored.position)) selectDomMatch(matches, stored.position);
      else tabPanelRef.current?.focus();
      return;
    }
    if (!currentNote || stored.docKey !== `note:${currentNote.id}:${mode}`) return;
    if (mode === 'edit') {
      editorRef.current?.focus();
      return;
    }
    const root = annotationTools.documentRef.current;
    if (!root) return;
    const matches = findDomMatches(root, query.query, query.caseSensitive);
    if (focusDomMatch(matches, stored.position)) selectDomMatch(matches, stored.position);
    else tabPanelRef.current?.focus();
    // Runs only on the open/close transition; the values above are from
    // the close render, which is what the focus target must reflect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [findOpen]);
  type ThesaurusSelection =
    | { kind: 'plain'; start: number; end: number }
    | { kind: 'rich'; range: Range; element: HTMLElement };
  const [thesaurusRequest, setThesaurusRequest] = useState<{
    word: string;
    selection: ThesaurusSelection | null;
  } | null>(null);

  /** Capture the selected word, if any, before the thesaurus dialog takes focus. */
  const captureThesaurusRequest = () => {
    const textarea = editorRef.current;
    if (textarea && textarea.selectionStart !== textarea.selectionEnd) {
      return {
        word: textarea.value.slice(textarea.selectionStart ?? 0, textarea.selectionEnd ?? 0),
        selection: {
          kind: 'plain' as const,
          start: textarea.selectionStart ?? 0,
          end: textarea.selectionEnd ?? 0,
        },
      };
    }
    const selection = document.getSelection();
    if (selection && !selection.isCollapsed) {
      const anchor = selection.anchorNode;
      const element = (anchor instanceof HTMLElement ? anchor : anchor?.parentElement)?.closest(
        '[contenteditable="true"]',
      ) as HTMLElement | null;
      if (element) {
        return {
          word: selection.toString(),
          selection: { kind: 'rich' as const, range: selection.getRangeAt(0).cloneRange(), element },
        };
      }
    }
    return { word: '', selection: null };
  };

  const replaceThesaurusSelection = (replacement: string) => {
    if (!currentNote || !thesaurusRequest?.selection) return;
    const selection = thesaurusRequest.selection;
    if (selection.kind === 'plain') {
      const content = currentNote.content;
      updateNoteContent(
        currentNote.id,
        content.slice(0, selection.start) + replacement + content.slice(selection.end),
      );
    } else {
      const domSelection = document.getSelection();
      if (domSelection) {
        domSelection.removeAllRanges();
        domSelection.addRange(selection.range);
        document.execCommand('insertText', false, replacement);
        selection.element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
      }
    }
    setThesaurusRequest(null);
    setStatusMessage(`Replaced with “${replacement}”.`);
  };

  const addToCustomDictionary = async (word: string) => {
    if (!window.a11yNotebook) return;
    const next = {
      ...settings,
      customDictionary: [...(settings.customDictionary ?? []), word],
    };
    await persistSettings(next);
  };

  const refreshVault = async () => {
    const root = vaultPathRef.current;
    const generation = vaultGenerationRef.current;
    const latest = await window.a11yNotebook?.vault.get();
    if (
      latest &&
      latest.path === root &&
      vaultPathRef.current === root &&
      !switchingRef.current &&
      generation === vaultGenerationRef.current
    )
      setVault(latest);
  };

  const [pasteLibraryPrompt, setPasteLibraryPrompt] = useState<{ name: string } | null>(null);
  const pasteLibraryResolver = useRef<((choice: PasteLibraryChoice) => void) | null>(null);
  const [pasteOrphanPrompt, setPasteOrphanPrompt] = useState<{ files: string[] } | null>(null);
  const pasteOrphanResolver = useRef<((result: PasteOrphanResult) => void) | null>(null);
  const [pasteBusy, setPasteBusy] = useState(false);

  const askPasteLibraryChoice = (name: string): Promise<PasteLibraryChoice> =>
    new Promise((resolve) => {
      pasteLibraryResolver.current = resolve;
      setPasteLibraryPrompt({ name });
    });

  const askPasteOrphanChoice = (files: string[]): Promise<PasteOrphanResult> =>
    new Promise((resolve) => {
      pasteOrphanResolver.current = resolve;
      setPasteOrphanPrompt({ files });
    });

  const openPastedLibrary = async (libraryPath: string): Promise<boolean> => {
    const bridge = window.a11yNotebook?.vault;
    if (!bridge?.pasteLibraryOpen) {
      setStatusMessage('Opening a pasted library is unavailable.');
      return false;
    }
    if (openNotes.some((note) => note.content !== note.saved) || activeConflict || switchingRef.current) {
      setStatusMessage('Save or resolve unsaved changes before opening another library.');
      return false;
    }
    switchingRef.current = true;
    vaultGenerationRef.current += 1;
    setSwitchingVault(true);
    try {
      const opened = await bridge.pasteLibraryOpen(libraryPath);
      if (opened) {
        vaultPathRef.current = opened.path;
        setVault(opened);
        setOpenNotes([]);
        setNotePasswordDialog(null);
        setAttachment(null);
        setAssetTabOpen(false);
        setAssetInitialPath(undefined);
        setAssetDirty(false);
        setSelectedTab('libraries');
        setStatusMessage(`Opened library ${opened.name}.`);
        refreshRecentLibraries();
        void restoreLibraryUiState(opened);
        return true;
      }
      return false;
    } catch {
      setStatusMessage('Could not open the pasted library.');
      return false;
    } finally {
      switchingRef.current = false;
      setSwitchingVault(false);
    }
  };

  /** Paste OS-copied files/folders into the current view. Text pastes and editor pastes are untouched. */
  const handlePanelPaste = async (event: ReactClipboardEvent<HTMLElement>) => {
    const files = event.clipboardData?.files;
    if (!files?.length || pasteBusy) return;
    const target = event.target as HTMLElement;
    if (target.closest('[contenteditable="true"], textarea, input, select')) return;
    if (selectedTab !== 'libraries' && selectedTab !== 'notebooks' && selectedTab !== 'notes-files') return;
    const bridge = window.a11yNotebook?.vault;
    if (!bridge?.getPathForFile || !bridge.pasteInspect) {
      setStatusMessage('Pasting files is not available in this build.');
      return;
    }
    const paths: string[] = [];
    for (const file of Array.from(files)) {
      const resolved = bridge.getPathForFile(file);
      if (resolved) paths.push(resolved);
    }
    if (!paths.length) {
      setStatusMessage('Could not read the pasted file paths.');
      return;
    }
    event.preventDefault();
    setPasteBusy(true);
    try {
      for (const source of paths) {
        const info = await bridge.pasteInspect(source);
        if (selectedTab === 'libraries') {
          if (info.kind !== 'folder') {
            setStatusMessage('Only folders can become libraries. Paste files into a notebook instead.');
            continue;
          }
          const choice = await askPasteLibraryChoice(info.name);
          if (choice === 'cancel') continue;
          let libraryPath = source;
          let copied = false;
          if (choice === 'copy') {
            if (!bridge.pasteChooseFolder || !bridge.pasteLibraryCopy) {
              setStatusMessage('Copying a pasted library is unavailable.');
              continue;
            }
            const parent = await bridge.pasteChooseFolder('Paste library — choose where to save the copy');
            if (!parent) continue;
            const result = await bridge.pasteLibraryCopy(source, parent);
            libraryPath = result.path;
            copied = true;
          }
          const libraryInfo = await bridge.pasteInspect(libraryPath);
          if (libraryInfo.files.length) {
            if (!bridge.pasteOrganize) {
              setStatusMessage('Organizing pasted library files is unavailable.');
              continue;
            }
            const result = await askPasteOrphanChoice(libraryInfo.files);
            if (result.mode === 'cancel') {
              setStatusMessage(
                copied
                  ? `Paste cancelled. The copy remains at ${libraryPath}; open it from Libraries when ready.`
                  : 'Paste cancelled. The original folder was not opened as a library.',
              );
              continue;
            }
            await bridge.pasteOrganize(
              libraryPath,
              libraryInfo.files,
              result.mode,
              result.mode === 'one' ? result.notebookName : undefined,
            );
          }
          await openPastedLibrary(libraryPath);
        } else if (selectedTab === 'notebooks') {
          if (!vault || securityLocked) {
            setStatusMessage('Open and unlock a library before pasting into it.');
            continue;
          }
          if (info.kind === 'folder') {
            if (!bridge.pasteNotebook) {
              setStatusMessage('Pasting a folder as a notebook is unavailable.');
              continue;
            }
            const result = await bridge.pasteNotebook(source);
            await refreshVault();
            setStatusMessage(`Pasted folder as notebook ${result.notebook}.`);
          } else if (selectedNotebookPath) {
            if (!bridge.pasteFiles) {
              setStatusMessage('Pasting files is unavailable.');
              continue;
            }
            await bridge.pasteFiles([source], selectedNotebookPath);
            await refreshVault();
            setStatusMessage(`Pasted ${info.name} into the selected notebook.`);
          } else {
            setStatusMessage('Select a notebook first, or paste the file in Notes and Files.');
          }
        } else {
          if (!vault || securityLocked || !selectedNotebookPath) {
            setStatusMessage('Select a notebook in Notes and Files before pasting files.');
            continue;
          }
          if (info.kind !== 'file') {
            setStatusMessage('Only files can be pasted into Notes and Files. Paste folders into Notebooks.');
            continue;
          }
          if (!bridge.pasteFiles) {
            setStatusMessage('Pasting files is unavailable.');
            continue;
          }
          await bridge.pasteFiles([source], selectedNotebookPath);
          await refreshVault();
          setStatusMessage(`Pasted ${info.name} into the selected notebook.`);
        }
      }
    } catch (failure) {
      setStatusMessage(failure instanceof Error ? failure.message : 'Could not paste.');
    } finally {
      setPasteBusy(false);
    }
  };

  const refreshLinkIndex = async () => {
    const root = vaultPathRef.current;
    const generation = vaultGenerationRef.current;
    const index = await window.a11yNotebook?.vault.getLinkIndex();
    const savedBookmarks = await window.a11yNotebook?.vault.getBookmarks();
    if (switchingRef.current || vaultPathRef.current !== root || generation !== vaultGenerationRef.current) return;
    if (index) setLinks(index.links);
    if (savedBookmarks) setBookmarks(savedBookmarks);
  };

  /**
   * Reload task links and drop any whose target no longer exists, so a
   * link to a note deleted outside the app (or before delete-time
   * cleanup existed) disappears on refresh instead of lingering as a
   * dead link. Never prunes when the library tree itself could not be
   * loaded: an empty tree would drop every link.
   */
  const refreshTaskLinks = async () => {
    const bridge = window.a11yNotebook?.vault;
    if (!bridge?.getTaskLinks || !bridge?.get) return;
    try {
      const [items, latest] = await Promise.all([bridge.getTaskLinks(), bridge.get()]);
      if (!latest) return;
      const existing = new Set(flattenEntries(latest.entries ?? []).map((entry) => entry.path));
      const kept = dropLinksToMissingTargets(items, existing);
      if (kept.length !== items.length && bridge.saveTaskLinks) {
        setTaskLinks(await bridge.saveTaskLinks(kept));
      } else {
        setTaskLinks(kept);
      }
    } catch {
      // Keep the displayed links when the reload fails.
    }
  };

  const brokenLinks = links.filter((link) => !link.resolved);

  const createBrokenLinkTarget = async (candidatePath: string) => {
    const bridge = window.a11yNotebook?.vault;
    if (!bridge?.createNote) {
      setStatusMessage('Creating notes is unavailable.');
      return;
    }
    try {
      const updated = await bridge.createNote(candidatePath);
      setVault(updated);
      setStatusMessage(`Created ${candidatePath}.`);
      await refreshLinkIndex();
    } catch {
      setStatusMessage(`Could not create ${candidatePath}.`);
    }
  };

  const retargetBrokenLink = async (link: VaultLink, newPath: string) => {
    const bridge = window.a11yNotebook?.vault;
    if (!bridge?.readNote || !bridge?.saveNote) {
      setStatusMessage('Editing notes is unavailable.');
      return;
    }
    if (!link.writtenTarget) {
      setStatusMessage('That link could not be retargeted.');
      return;
    }
    const open = openNotes.find((note) => note.path === link.sourcePath);
    if (open && open.content !== open.saved) {
      setStatusMessage(`Save or discard changes in ${link.sourcePath} before retargeting its link.`);
      return;
    }
    try {
      const before = await bridge.readNote(link.sourcePath);
      const after = retargetLinkContent(before, link.sourcePath, link.writtenTarget, newPath);
      if (after === null) {
        setStatusMessage('That link was already changed.');
        await refreshLinkIndex();
        return;
      }
      await bridge.saveNote(link.sourcePath, after, before);
      if (open) {
        updateNoteContent(open.id, after, 'edit');
        setOpenNotes((items) => items.map((item) => (item.id === open.id ? { ...item, saved: after } : item)));
      }
      setStatusMessage(`Retargeted the link to ${newPath}.`);
      await refreshLinkIndex();
    } catch {
      setStatusMessage('Could not retarget that link.');
    }
  };

  const openLinkTarget = async (href: string) => {
    const currentNote = openNotes.find((item) => item.id === selectedTab);
    if (!currentNote) return;
    let targetTitle = href;
    let targetPath = links.find((link) => link.sourcePath === currentNote.path && link.targetPath === href)?.targetPath;
    if (href.startsWith('#wiki:')) {
      try {
        targetTitle = decodeURIComponent(href.slice('#wiki:'.length));
      } catch {
        targetTitle = href.slice('#wiki:'.length);
      }
      targetPath = links.find(
        (link) =>
          link.sourcePath === currentNote.path &&
          link.targetTitle.toLocaleLowerCase() === targetTitle.toLocaleLowerCase() &&
          link.resolved,
      )?.targetPath;
    } else {
      const cleanHref = href.split('#')[0].split('?')[0];
      const base = currentNote.path.includes('/')
        ? currentNote.path.slice(0, currentNote.path.lastIndexOf('/') + 1)
        : '';
      const normalizedParts: string[] = [...base.split('/').filter(Boolean)];
      for (const part of cleanHref.split('/')) {
        if (!part || part === '.') continue;
        if (part === '..') normalizedParts.pop();
        else normalizedParts.push(part);
      }
      const candidate = normalizedParts.join('/');
      const withExtension = /\.[^/]+$/.test(candidate) ? candidate : `${candidate}.md`;
      targetPath = links.find(
        (link) =>
          link.sourcePath === currentNote.path &&
          link.targetPath?.toLocaleLowerCase() === withExtension.toLocaleLowerCase(),
      )?.targetPath;
    }
    if (!targetPath) {
      setStatusMessage(`Missing note: ${targetTitle}.`);
      return;
    }
    const targetEntry = findEntry(vault?.entries ?? [], targetPath);
    if (targetEntry) await openEntry(targetEntry);
  };

  const convertActiveNoteFormat = async () => {
    const note = openNotes.find((item) => item.id === selectedTab);
    const bridge = window.a11yNotebook?.vault;
    if (!note || !bridge) return;
    if (await bridge.isNoteEncrypted?.(note.path)) {
      setStatusMessage('Decrypt this note to a separate unprotected copy before converting it.');
      return;
    }
    const from = /\.html?$/i.test(note.path) ? 'html' : 'markdown';
    const to = from === 'html' ? 'markdown' : 'html';
    const targetPath = note.path.replace(/\.(?:md|html|htm|txt)$/i, to === 'html' ? '.html' : '.md');
    if (!window.confirm(formatConversionWarning(note.content, from, to))) return;
    try {
      const converted = convertNoteContent(note.content, from, to, targetPath);
      const updated = await bridge.createNote(targetPath, converted);
      setVault(updated);
      const created = findEntry(updated.entries, targetPath);
      if (created) await openEntry(created);
      setStatusMessage(`Created ${to.toUpperCase()} copy. The original note was kept.`);
    } catch {
      setStatusMessage('Could not convert this note. Check whether a sibling note already exists.');
    }
  };

  const convertActiveNoteToOutline = async () => {
    const note = openNotes.find((item) => item.id === selectedTab);
    const bridge = window.a11yNotebook?.vault;
    if (!note || !bridge) return;
    if (!/\.md$/i.test(note.path) || /\.(?:outline|cards|grid)\.md$/i.test(note.path)) {
      setStatusMessage('Only Markdown notes can be converted to an outline.');
      return;
    }
    if (await bridge.isNoteEncrypted?.(note.path)) {
      setStatusMessage('Decrypt this note to a separate unprotected copy before converting it.');
      return;
    }
    const targetPath = note.path.replace(/\.md$/i, '.outline.md');
    const { outline, message } = outlineConversionWarning(note.content, targetPath);
    if (!outline) {
      setStatusMessage('This note has no content to convert to an outline.');
      return;
    }
    if (!window.confirm(message)) return;
    try {
      const updated = await bridge.createNote(targetPath, outline);
      setVault(updated);
      const created = findEntry(updated.entries, targetPath);
      if (created) await openEntry(created);
      setStatusMessage('Created outline copy. The original note was kept.');
    } catch {
      setStatusMessage('Could not create the outline. Check whether a sibling outline already exists.');
    }
  };

  const toggleActiveBookmark = async () => {
    const note = openNotes.find((item) => item.id === selectedTab);
    if (!note || !window.a11yNotebook) return;
    try {
      const nextBookmarks = await window.a11yNotebook.vault.toggleBookmark(note.path);
      setBookmarks(nextBookmarks);
      const isBookmarked = nextBookmarks.some((bookmark) => bookmark.path === note.path);
      setStatusMessage(isBookmarked ? 'Note bookmarked.' : 'Bookmark removed.');
    } catch {
      setStatusMessage('Could not update the bookmark.');
    }
  };

  const addAnchoredBookmark = async (kind: 'heading' | 'position') => {
    const note = openNotes.find((item) => item.id === selectedTab);
    if (!note || !window.a11yNotebook) return;
    const caret = editorRef.current?.selectionStart ?? 0;
    if (kind === 'heading') {
      const anchor = headingAnchorAt(note.content, /\.html?$/i.test(note.path), caret);
      if (!anchor) {
        setStatusMessage('No heading at or before the cursor to bookmark.');
        return;
      }
      // The name prompt is pre-filled with the heading as the reader sees
      // it; the user accepts it or types a better name.
      setBookmarkNameRequest({
        path: note.path,
        anchor,
        suggestedName: normalizeHeadingText(anchor.text),
      });
    } else {
      const anchor: BookmarkAnchor = { kind: 'offset', offset: caret };
      const context = surroundingText(note.content, caret, 200);
      setBookmarkNameRequest({
        path: note.path,
        anchor,
        suggestedName:
          surroundingText(note.content, caret) ||
          note.path.split('/').pop()?.replace(/\.[^.]+$/, '') ||
          'Bookmark',
        ...(context ? { context } : {}),
      });
    }
  };

  const submitBookmarkName = async (name: string) => {
    const request = bookmarkNameRequest;
    if (!request || !window.a11yNotebook) return;
    try {
      const nextBookmarks = await window.a11yNotebook.vault.addBookmark(
        request.path,
        request.anchor,
        name,
        request.context,
      );
      setBookmarks(nextBookmarks);
      setStatusMessage(
        request.anchor.kind === 'heading' ? `Bookmarked heading "${name}".` : `Bookmarked "${name}".`,
      );
    } catch {
      throw new Error('Could not add the bookmark.');
    }
  };

  const removeBookmarkById = async (id: string) => {
    if (!window.a11yNotebook) return;
    try {
      setBookmarks(await window.a11yNotebook.vault.removeBookmark(id));
      setStatusMessage('Bookmark removed.');
    } catch {
      setStatusMessage('Could not remove the bookmark.');
    }
  };

  // Focus the heading a bookmark points at in the reading view. Returns
  // the focused heading, or null when there is no heading to land on (a
  // position bookmark before the first heading, or a note with no
  // headings). The comparison uses the rendered heading text: an anchor
  // stores the heading as written in source (`Hello *world*`), while the
  // reading view shows it formatted (`Hello world`).
  // Focus alone does not move a screen reader's virtual cursor, so the
  // heading's text is selected after focus lands — mirroring Find, which
  // re-selects its match after focusing for the same reason. Returns the
  // heading only when both focus and a live selection are in place.
  const focusBookmarkHeading = (content: string, isHtml: boolean, anchor: BookmarkAnchor): HTMLElement | null => {
    const jumpHeading = readingJumpHeading(content, isHtml, anchor);
    if (!jumpHeading) return null;
    const container = annotationTools.documentRef.current;
    const headings = container
      ? [...container.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')]
      : [];
    const wanted = normalizeHeadingText(jumpHeading.text);
    const matches = headings.filter(
      (heading) => normalizeHeadingText(heading.textContent?.trim() ?? '') === wanted,
    );
    const target = matches[jumpHeading.occurrence] ?? matches[0];
    if (!target) return null;
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus();
    const selected = selectElementContents(target);
    try {
      target.scrollIntoView({ block: 'start' });
    } catch {
      // Scrolling is best-effort; the focus landing is what matters.
    }
    const selection = window.getSelection();
    return document.activeElement === target &&
      selected &&
      !!selection?.anchorNode &&
      target.contains(selection.anchorNode)
      ? target
      : null;
  };

  // Land a position bookmark that sits before the first heading: there is
  // no heading to focus, so focus the reading document and select the
  // rendered text of the source line at the bookmarked offset instead of
  // silently falling back to the top of the note. Returns the container
  // only when both focus and a live selection are in place.
  const focusBookmarkPosition = (content: string, isHtml: boolean, anchor: BookmarkAnchor): HTMLElement | null => {
    const container = annotationTools.documentRef.current;
    if (!container) return null;
    const offset = resolveBookmarkAnchor(content, isHtml, anchor);
    if (offset === null) return null;
    const line = lineSpanAt(content, offset);
    if (!line) return null;
    if (!container.hasAttribute('tabindex')) container.setAttribute('tabindex', '-1');
    container.focus();
    const selected = selectRenderedLine(container, normalizeHeadingText(content.slice(line.start, line.end)));
    try {
      container.scrollIntoView({ block: 'start' });
    } catch {
      // Scrolling is best-effort; the focus landing is what matters.
    }
    const selection = window.getSelection();
    return document.activeElement === container &&
      selected &&
      !!selection?.anchorNode &&
      container.contains(selection.anchorNode)
      ? container
      : null;
  };

  // Move the caret to the bookmarked place in the rich-text editor, which
  // has no textarea: the edit branch of the jump cannot use editorRef.
  // A heading anchor selects the heading's text (a collapsed caret does
  // not move the virtual cursor); a position anchor selects the rendered
  // text of the line at its offset, falling back to the start of the
  // editor only when that line cannot be found. Returns true when the
  // editor has focus and a live selection is in place.
  const focusRichTextBookmark = (content: string, isHtml: boolean, anchor: BookmarkAnchor): boolean => {
    const editor = document.querySelector<HTMLElement>('[role="textbox"][aria-label="Rich text editor"]');
    if (!editor) return false;
    editor.focus();
    const selection = window.getSelection();
    if (!selection) return false;
    if (anchor.kind === 'heading') {
      const jumpHeading = readingJumpHeading(content, isHtml, anchor);
      if (!jumpHeading) return false;
      const wanted = normalizeHeadingText(jumpHeading.text);
      const headings = [...editor.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')];
      const matches = headings.filter(
        (heading) => normalizeHeadingText(heading.textContent?.trim() ?? '') === wanted,
      );
      const target = matches[jumpHeading.occurrence] ?? matches[0];
      if (!target) return false;
      if (!selectElementContents(target)) return false;
    } else {
      const offset = resolveBookmarkAnchor(content, isHtml, anchor);
      const line = offset === null ? null : lineSpanAt(content, offset);
      if (
        !line ||
        !selectRenderedLine(editor, normalizeHeadingText(content.slice(line.start, line.end)))
      ) {
        const range = document.createRange();
        range.selectNodeContents(editor);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        return document.activeElement === editor;
      }
    }
    return (
      document.activeElement === editor &&
      selection.rangeCount > 0 &&
      selection.toString().length > 0 &&
      !!selection.anchorNode &&
      editor.contains(selection.anchorNode)
    );
  };

  // A bookmark jump suppresses the next resume only while that note stays
  // open. Leaving the note forgets the jump, so reopening the note
  // resumes normally instead of re-landing on the old bookmark.
  useEffect(() => {
    if (bookmarkJumpRef.current && bookmarkJumpRef.current.path !== currentNote?.path) {
      bookmarkJumpRef.current = null;
    }
  }, [currentNote?.path]);

  // After a bookmark with an anchor is activated, land the caret (edit
  // mode) or focus (reading view) at the anchored place once the note is
  // the current one. The first attempt is deferred a tick: opening a note
  // (or switching to it) can change the mode in a later effect in the
  // same commit, which swaps the editor for the reading view (or the
  // reverse) and destroys whatever the jump just focused — that is how a
  // jump used to land and then lose focus, leaving the reader at the top
  // of the note. The anchor is only cleared once the landing is verified
  // (focus really is on the target), and a landing that cannot be made
  // yet is retried a bounded number of times instead of being dropped.
  useEffect(() => {
    if (!pendingBookmarkAnchor || currentNote?.path !== pendingBookmarkAnchor.path) return;
    const { anchor } = pendingBookmarkAnchor;
    const isHtml = /\.html?$/i.test(currentNote.path);
    const offset = resolveBookmarkAnchor(currentNote.content, isHtml, anchor);
    if (offset === null) {
      setPendingBookmarkAnchor(null);
      setStatusMessage('That bookmarked heading no longer exists in the note.');
      return;
    }
    const path = currentNote.path;
    const content = currentNote.content;
    const jumpHeading = readingJumpHeading(content, isHtml, anchor);
    const headingName = jumpHeading ? normalizeHeadingText(jumpHeading.text) : null;
    const announce = () =>
      setStatusMessage(headingName ? `Jumped to ${headingName}.` : 'Jumped to the bookmarked place.');
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    const tryLand = () => {
      if (cancelled) return;
      attempts += 1;
      const textarea = editorRef.current;
      if (textarea && mode === 'edit') {
        textarea.focus();
        // A collapsed caret does not move the virtual cursor: select the
        // heading's text for a heading anchor, or the line at the offset
        // for a position anchor.
        const span = headingTextSpan(content, isHtml, anchor) ?? lineSpanAt(content, offset);
        const start = span?.start ?? offset;
        const end = span?.end ?? offset;
        try {
          textarea.setSelectionRange(start, end);
        } catch {
          // The caret landing is best-effort; the note is open either way.
        }
        if (
          document.activeElement === textarea &&
          textarea.selectionStart === start &&
          textarea.selectionEnd === end
        ) {
          bookmarkJumpRef.current = { path, anchor };
          setPendingBookmarkAnchor(null);
          announce();
          return;
        }
      } else if (mode === 'edit' && focusRichTextBookmark(content, isHtml, anchor)) {
        bookmarkJumpRef.current = { path, anchor };
        setPendingBookmarkAnchor(null);
        announce();
        return;
      } else if (mode !== 'edit') {
        const target =
          focusBookmarkHeading(content, isHtml, anchor) ?? focusBookmarkPosition(content, isHtml, anchor);
        if (target && document.activeElement === target) {
          bookmarkJumpRef.current = { path, anchor };
          setPendingBookmarkAnchor(null);
          announce();
          return;
        }
      }
      if (attempts < 10) {
        timer = setTimeout(tryLand, 50);
        return;
      }
      // The target never became focusable: focus already rests on the
      // note's main region (opening the note requests it), which is the
      // top of the note, so the jump still lands the reader in the note.
      bookmarkJumpRef.current = { path, anchor };
      setPendingBookmarkAnchor(null);
      setStatusMessage('Opened at the bookmarked place.');
    };
    timer = setTimeout(tryLand, 0);
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingBookmarkAnchor, currentNote, mode]);

  // Resume a note in reading mode at the heading the reader had reached.
  // A bookmark jump takes precedence: when one is pending, this stays out
  // of its way instead of fighting it for the scroll position.
  useEffect(() => {
    if (mode !== 'read-only' || !currentNote || pendingBookmarkAnchor) return;
    const bridge = window.a11yNotebook?.vault;
    if (!bridge?.getReadingPosition) return;
    const path = currentNote.path;
    const jumped = bookmarkJumpRef.current;
    if (jumped && jumped.path === path) {
      bookmarkJumpRef.current = null;
      // The reader just landed on a bookmark (or switched views after
      // one): keep the reader at the bookmarked heading instead of
      // resuming to the saved reading position. A position bookmark with
      // no heading lands on its line instead; only when neither landing
      // works does it fall through to the normal resume below.
      const jumpedHeading = focusBookmarkHeading(
        currentNote.content,
        /\.html?$/i.test(currentNote.path),
        jumped.anchor,
      );
      const jumpedTarget =
        jumpedHeading ??
        focusBookmarkPosition(currentNote.content, /\.html?$/i.test(currentNote.path), jumped.anchor);
      if (jumpedTarget) {
        setStatusMessage(
          jumpedHeading
            ? `Jumped to ${jumpedHeading.textContent?.trim() ?? 'the bookmarked heading'}.`
            : 'Jumped to the bookmarked place.',
        );
        return;
      }
    }
    let cancelled = false;
    void bridge
      .getReadingPosition(path)
      .then((saved) => {
        if (cancelled || !saved?.heading) return;
        const container = annotationTools.documentRef.current;
        const headings = container ? [...container.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')] : [];
        const wanted = normalizeHeadingText(saved.heading);
        const matches = headings.filter(
          (heading) => normalizeHeadingText(heading.textContent?.trim() ?? '') === wanted,
        );
        const target = matches[saved.occurrence ?? 0] ?? matches[0];
        if (target) {
          if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
          target.focus();
          try {
            target.scrollIntoView({ block: 'start' });
          } catch {
            // Scrolling is best-effort; the focus landing is what matters.
          }
          setStatusMessage(`Resumed at ${saved.heading}.`);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, currentNote?.path]);

  // Track the heading reached while reading, and save it (debounced, with
  // a flush when leaving the note) so reopening resumes there.
  useEffect(() => {
    if (mode !== 'read-only' || !currentNote) return;
    const bridge = window.a11yNotebook?.vault;
    if (!bridge?.setReadingPosition) return;
    const path = currentNote.path;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let last: { heading: string; occurrence: number } | null = null;
    const flush = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      if (last) void bridge.setReadingPosition!(path, last).catch(() => undefined);
    };
    const onScroll = () => {
      const container = annotationTools.documentRef.current;
      if (!container) return;
      const headings = [...container.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')].map((heading) => ({
        text: heading.textContent?.trim() ?? '',
        top: heading.getBoundingClientRect().top,
      }));
      const current = notePositionFromHeadings(headings);
      if (current && (current.heading !== last?.heading || current.occurrence !== last?.occurrence)) {
        last = current;
        if (timer) clearTimeout(timer);
        timer = setTimeout(flush, 600);
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, currentNote?.path]);

  // Drop fallback-undo histories for notes that are no longer open.
  useEffect(() => {
    const openIds = new Set(openNotes.map((note) => note.id));
    for (const id of editHistoriesRef.current.keys()) {
      if (!openIds.has(id)) {
        editHistoriesRef.current.delete(id);
        noteSnapshotsRef.current.delete(id);
        purgeTimelineNote(undoTimelineRef.current, id);
      }
    }
  }, [openNotes]);

  const handleProtectedUnprotect = async () => {
    if (!protectedRequest) return;
    const bridge = window.a11yNotebook?.vault;
    if (!bridge?.setProtection) throw new Error('Protection is unavailable.');
    const updated = await bridge.setProtection(protectedRequest.blockingPath, false);
    setVault(updated);
    const request = protectedRequest;
    setProtectedRequest(null);
    if (request.action === 'edit') {
      setMode('edit');
    } else if (request.action === 'rename') {
      renameEntry(request.targetPath, true);
    } else if (request.action === 'move') {
      setItemDialog({ action: 'move', path: request.targetPath });
    } else if (request.action === 'delete') {
      void deleteEntry(request.targetPath, true);
    } else if (request.action === 'delete-permanent') {
      void deleteEntryPermanently(request.targetPath, true);
    }
  };

  /**
   * After staged Organize Library changes are applied, remap open notes,
   * the selected tab, the tree selection, and the selected notebook to
   * their new paths, and close tabs whose path is gone. Only notes whose
   * path changed are re-read, so dirty notes are never clobbered; a
   * move or rename commit already refuses to run while any note is dirty.
   */
  const applyOrganizeResult = (ops: StagedOp[], finalVault: VaultInfo, partial: boolean) => {
    setVault(finalVault);
    setStatusMessage(
      partial
        ? 'Some staged changes applied. The remaining changes are still staged in the Organize Library dialog.'
        : 'Staged changes applied.',
    );
    const bridge = window.a11yNotebook?.vault;
    if (!bridge) return;
    void (async () => {
      const refreshed = await Promise.all(
        openNotes.map(async (note) => {
          const nextPath = remapPathAfterOps(note.path, ops);
          if (nextPath === null) return null;
          if (nextPath === note.path) return note;
          try {
            const content = await bridge.readNote(nextPath);
            return {
              ...note,
              id: nextPath,
              path: nextPath,
              title: nextPath
                .split('/')
                .at(-1)!
                .replace(/\.(?:md|html|htm|txt)$/i, ''),
              content,
              saved: content,
            };
          } catch {
            return {
              ...note,
              id: nextPath,
              path: nextPath,
              title: nextPath.split('/').at(-1) ?? note.title,
            };
          }
        }),
      );
      setOpenNotes(refreshed.filter((note): note is OpenNote => note !== null));
      setSelectedTab((current) => {
        if (!openNotes.some((note) => note.id === current)) return current;
        return remapPathAfterOps(current, ops) ?? 'notes-files';
      });
      setTreeSelection((current) => (current ? remapPathAfterOps(current, ops) : current));
      setSelectedNotebookPath((current) => (current ? (remapPathAfterOps(current, ops) ?? undefined) : current));
      for (const note of openNotes) synchronization.clearConflict(note.path);
    })();
  };

  const deleteEntry = async (entryPath: string, bypassProtection = false, skipTaskGuard = false) => {
    if (!bypassProtection && findProtectionBlockInTree(vault?.entries ?? [], entryPath)) {
      openProtectedRequest(entryPath, 'delete');
      return;
    }
    if (!skipTaskGuard) {
      // Tasks are checklist lines inside notes: deleting a note deletes
      // its tasks with it. Warn first, naming the count, so the loss is
      // never a surprise. A notebook counts the tasks in every note
      // inside it.
      const entry = findEntry(vault?.entries ?? [], entryPath);
      const taskCount = tasks.filter(
        (task) => task.path === entryPath || task.path.startsWith(`${entryPath}/`),
      ).length;
      if (taskCount > 0) {
        setDeleteGuard({
          path: entryPath,
          name: entry?.name ?? entryPath.split('/').at(-1) ?? entryPath,
          kind: entry?.kind === 'notebook' ? 'notebook' : 'note',
          permanent: false,
          taskCount,
        });
        return;
      }
    }
    const affectedNotes = openNotes.filter((item) => item.path === entryPath || item.path.startsWith(`${entryPath}/`));
    if (
      affectedNotes.some((item) => item.content !== item.saved) &&
      !window.confirm('This item contains unsaved note changes. Continue and discard them?')
    ) {
      return;
    }
    try {
      const updated = await window.a11yNotebook?.vault.delete(entryPath);
      if (!updated) return;
      setVault(updated);
      if (findEntry(updated.entries, entryPath)) return;
      setOpenNotes((current) =>
        current.filter((item) => item.path !== entryPath && !item.path.startsWith(`${entryPath}/`)),
      );
      if (affectedNotes.some((item) => item.id === selectedTab)) setSelectedTab('notes-files');
    } catch {
      setStatusMessage('Could not delete the selected item.');
    }
  };

  const deleteEntryPermanently = async (entryPath: string, bypassProtection = false, skipTaskGuard = false) => {
    if (!bypassProtection && findProtectionBlockInTree(vault?.entries ?? [], entryPath)) {
      openProtectedRequest(entryPath, 'delete-permanent');
      return;
    }
    if (!skipTaskGuard) {
      const entry = findEntry(vault?.entries ?? [], entryPath);
      const taskCount = tasks.filter(
        (task) => task.path === entryPath || task.path.startsWith(`${entryPath}/`),
      ).length;
      if (taskCount > 0) {
        setDeleteGuard({
          path: entryPath,
          name: entry?.name ?? entryPath.split('/').at(-1) ?? entryPath,
          kind: entry?.kind === 'notebook' ? 'notebook' : 'note',
          permanent: true,
          taskCount,
        });
        return;
      }
    }
    const affectedNotes = openNotes.filter((item) => item.path === entryPath || item.path.startsWith(`${entryPath}/`));
    const hasUnsavedChanges = affectedNotes.some((item) => item.content !== item.saved);
    try {
      const updated = await window.a11yNotebook?.vault.deletePermanently(entryPath, hasUnsavedChanges);
      if (!updated) return;
      setVault(updated);
      if (findEntry(updated.entries, entryPath)) return;
      setOpenNotes((current) =>
        current.filter((item) => item.path !== entryPath && !item.path.startsWith(`${entryPath}/`)),
      );
      if (affectedNotes.some((item) => item.id === selectedTab)) setSelectedTab('notes-files');
      setStatusMessage('Item permanently deleted.');
    } catch {
      setStatusMessage('Could not delete the selected item.');
    }
  };

  const renameEntry = (entryPath: string, bypassProtection = false) => {
    if (!bypassProtection && findProtectionBlockInTree(vault?.entries ?? [], entryPath)) {
      openProtectedRequest(entryPath, 'rename');
      return;
    }
    setItemDialog({ action: 'rename', path: entryPath, name: entryPath.split('/').at(-1) });
  };

  const submitItem = async (name: string, notebook: string, format: 'markdown' | 'html' | 'txt' = 'markdown') => {
    const bridge = window.a11yNotebook?.vault;
    if (!bridge || !vault || !itemDialog) return;
    const request = itemDialog;
    if (request.action === 'new-note' || request.action === 'new-notebook') {
      const selected = findEntry(vault.entries, treeSelection);
      const parent =
        request.path ??
        selectedNotebookPath ??
        (selected?.kind === 'notebook' ? selected.path : (selected?.path.split('/').slice(0, -1).join('/') ?? ''));
      const leaf =
        request.action === 'new-note'
          ? `${name.replace(/\.(?:md|html|htm|txt)$/i, '')}.${format === 'html' ? 'html' : format === 'txt' ? 'txt' : 'md'}`
          : name;
      const relative = [parent, leaf].filter(Boolean).join('/');
      setVault(
        request.action === 'new-note' ? await bridge.createNote(relative) : await bridge.createNotebook(relative),
      );
      if (request.action === 'new-note')
        await openEntry({ name: leaf, path: relative, kind: 'note', provenance: 'created' });
      if (request.action === 'new-note') {
        // A note that was just created is created to be written in: it
        // opens in Editing mode with the editor focused, regardless of
        // the default open mode. The refs survive the mode effect that
        // applies the default when the new tab becomes current.
        forceEditNoteRef.current = relative;
        pendingEditorFocusRef.current = { path: relative };
        setMode('edit');
      }
      setStatusMessage(`${request.action === 'new-note' ? 'Note' : 'Notebook'} created.`);
      return;
    }
    if (openNotes.some((note) => note.content !== note.saved))
      throw new Error('Save or resolve all unsaved notes before moving or repairing links.');
    const source = request.path!;
    const parent = request.action === 'rename' ? source.split('/').slice(0, -1).join('/') : notebook;
    const destination = [parent, request.action === 'rename' ? name : source.split('/').at(-1)]
      .filter(Boolean)
      .join('/');
    if (source === destination) throw new Error('Choose a different name or notebook.');
    const moved = (relative: string) =>
      relative === source || relative.startsWith(`${source}/`) ? destination + relative.slice(source.length) : relative;
    let updated: VaultInfo;
    setRelocatingPath(source);
    try {
      updated =
        request.action === 'rename' ? await bridge.rename(source, name) : await bridge.move(source, destination);
      setVault(updated);
      if (!findEntry(updated.entries, source))
        setSelectedNotebookPath((current) => (current ? moved(current) : current));
    } finally {
      setRelocatingPath(undefined);
    }
    if (findEntry(updated.entries, source)) return; // Native confirmation was cancelled.
    const refreshed = await Promise.all(
      openNotes.map(async (note) => {
        const nextPath = moved(note.path);
        const content = await bridge.readNote(nextPath);
        return {
          ...note,
          id: nextPath,
          path: nextPath,
          title: nextPath
            .split('/')
            .at(-1)!
            .replace(/\.(?:md|html|htm|txt)$/i, ''),
          content,
          saved: content,
        };
      }),
    );
    setOpenNotes(refreshed);
    setSelectedTab(moved(selectedTab));
    setTreeSelection(destination);
    for (const note of openNotes) synchronization.clearConflict(note.path);
    setStatusMessage('Item moved and local links repaired.');
  };

  const handleTreeAction = (entry: VaultEntry, action: TreeAction) => {
    selectEntry(entry);
    if (action === 'new-note') setItemDialog({ action: 'new-note' });
    else if (action === 'new-template') handleCommand('new-from-template');
    else if (action === 'rename') renameEntry(entry.path);
    else if (action === 'move') {
      if (findProtectionBlockInTree(vault?.entries ?? [], entry.path)) openProtectedRequest(entry.path, 'move');
      else setItemDialog({ action: 'move', path: entry.path });
    }
    else if (action === 'delete') void deleteEntry(entry.path);
    else if (action === 'bookmark')
      void window.a11yNotebook?.vault
        .toggleBookmark(entry.path)
        .then(setBookmarks)
        .catch(() => setStatusMessage('Could not update bookmark.'));
    else
      void (
        action === 'reveal'
          ? window.a11yNotebook?.vault.reveal(entry.path)
          : window.a11yNotebook?.vault.openExternal(entry.path)
      )?.catch(() => setStatusMessage('Could not open the selected item.'));
  };

  const openContextMenu = (target: HTMLElement, pointer?: { x: number; y: number }) => {
    if (activeDialog || itemDialog || activeConflict || document.querySelector('[role="dialog"], [role="alertdialog"]'))
      return;
    const link = target.closest<HTMLAnchorElement>('a[href]');
    const marker = target.closest<HTMLElement>('[data-context]');
    const editable = target.closest<HTMLElement>('textarea, input:not([type="checkbox"]), [contenteditable="true"]');
    const context = (
      link ? 'reader-link' : (marker?.dataset.context ?? (editable ? 'editor-selection' : 'general'))
    ) as MenuContext;
    const contextElement = marker ?? link ?? editable ?? target;
    const path = contextElement.dataset.path ?? contextElement.closest<HTMLElement>('[data-path]')?.dataset.path;
    const tabId = contextElement.dataset.tabId ?? contextElement.closest<HTMLElement>('[data-tab-id]')?.dataset.tabId;
    const selection =
      editable instanceof HTMLTextAreaElement || editable instanceof HTMLInputElement
        ? editable.value.slice(editable.selectionStart ?? 0, editable.selectionEnd ?? 0)
        : (document.getSelection()?.toString() ?? '');
    const range = document.getSelection();
    const selectionRange = range && !range.isCollapsed ? range.getRangeAt(0).cloneRange() : undefined;
    const invoker = contextElement.matches(
      'button, a, [role="treeitem"], [role="tab"], textarea, input, [contenteditable="true"], [data-context]',
    )
      ? contextElement
      : document.activeElement instanceof HTMLElement
        ? document.activeElement
        : contextElement;
    if (invoker === contextElement && contextElement.dataset.context) contextElement.focus();
    if (contextElement.matches('[role="treeitem"]')) {
      invoker.focus();
      if (path) setTreeSelection(path);
    }
    if (tabId) setSelectedTab(tabId);
    const bounds = invoker.getBoundingClientRect();
    setContextMenu({
      context,
      invoker,
      path,
      tabId,
      href: link?.getAttribute('href') ?? undefined,
      selection,
      selectionStart:
        editable instanceof HTMLTextAreaElement || editable instanceof HTMLInputElement
          ? (editable.selectionStart ?? undefined)
          : undefined,
      selectionEnd:
        editable instanceof HTMLTextAreaElement || editable instanceof HTMLInputElement
          ? (editable.selectionEnd ?? undefined)
          : undefined,
      selectionRange,
      x: pointer?.x ?? bounds.left,
      y: pointer?.y ?? bounds.bottom,
    });
  };

  /**
   * Focus Mode (F11): hide every persistent chrome pane except the title
   * header (which holds the search box), the menu bar, and the document
   * itself. It is React state only, never saved to settings, so closing
   * and reopening the app always starts with the full layout. Exiting also
   * happens automatically when the active document stops being the active
   * tab (see the selectedTab effect below), which covers closing the note
   * and switching to another view. Dialogs and context menus are transient
   * overlays, not chrome, so they still open above Focus Mode.
   */
  const toggleFocusMode = () => {
    if (focusMode) {
      setFocusMode(false);
      announceFocusMode('Focus mode off. The full layout is shown again.');
      return;
    }
    if (!currentNote) {
      setStatusMessage('Open a note or file to use Focus mode.');
      return;
    }
    setContextMenu(null);
    setFocusMode(true);
    announceFocusMode(
      'Focus mode on. Only the title, menu, search, and document are shown. Press F11 to exit Focus mode.',
    );
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !active.closest('.app-header, .menu-bar, .document')) {
      tabPanelRef.current?.focus();
      setActiveRegion('main');
    }
  };

  // Closing a library closes everything inside it: every open note, file,
  // task, reminder, asset, and attachment tab, plus the notebook selection.
  // The app returns to the Libraries view with focus on the libraries grid.
  const closeLibraryState = () => {
    vaultGenerationRef.current += 1;
    setVault(null);
    setOpenNotes([]);
    setAttachment(null);
    setAssetTabOpen(false);
    setAssetInitialPath(undefined);
    setAssetDirty(false);
    setTaskTabOpen(false);
    setReminderTabOpen(false);
    setSelectedNotebookPath(undefined);
    setTreeSelection(null);
    setPinnedTabs(new Set());
    setSelectedTab('libraries');
    setPendingLibraryGridFocus(true);
    // A closed library must stay closed across a restart, so forget the
    // last-opened marker (the recents picker keeps the library).
    void window.a11yNotebook?.vault.forgetLastOpened?.().catch(() =>
      setStatusMessage('The library was closed, but it may reopen on next launch.'),
    );
  };

  const closeLibrary = () => {
    if (!vault) {
      setStatusMessage('No library is open.');
      return;
    }
    if (
      assetDirty ||
      assetBusy ||
      openNotes.some((note) => note.content !== note.saved) ||
      activeConflict ||
      switchingRef.current
    ) {
      setStatusMessage('Save or resolve unsaved changes before closing the library.');
      return;
    }
    const name = vault.name;
    closeLibraryState();
    setStatusMessage(`Closed library ${name}.`);
    refreshRecentLibraries();
  };

  // Deleting a library moves its whole folder to the Recycle Bin. The
  // folder is deleted first and the open state closes after, so a failed
  // delete never strands the user without their open library; unsaved
  // changes block the delete exactly like they block closing.
  const confirmDeleteLibrary = async () => {
    const target = deleteLibraryTarget;
    if (!target) return;
    const isOpen = vault?.path === target.path;
    if (
      isOpen &&
      (assetDirty ||
        assetBusy ||
        openNotes.some((note) => note.content !== note.saved) ||
        activeConflict ||
        switchingRef.current)
    ) {
      setStatusMessage('Save or resolve unsaved changes before closing the library.');
      setDeleteLibraryTarget(null);
      return;
    }
    const bridge = window.a11yNotebook?.vault;
    if (!bridge?.deleteLibrary) {
      setStatusMessage('Library deletion is unavailable.');
      setDeleteLibraryTarget(null);
      return;
    }
    setDeleteLibraryTarget(null);
    try {
      // Permanent delete is opt-in only: the existing call shape (one
      // argument) keeps meaning "move to the Recycle Bin".
      if (target.permanent) await bridge.deleteLibrary(target.path, true);
      else await bridge.deleteLibrary(target.path);
    } catch (reason) {
      // Surface the reason instead of a generic failure: a refused path
      // ("only a recently opened library") and a trash failure need
      // different next steps, and the user cannot diagnose a silent one.
      setStatusMessage(
        `Could not delete the library${reason instanceof Error ? `: ${reason.message}` : '.'}`,
      );
      return;
    }
    if (isOpen) closeLibraryState();
    setStatusMessage(target.permanent ? `Permanently deleted library ${target.name}.` : `Deleted library ${target.name}.`);
    refreshRecentLibraries();
  };

  const closeContextTab = (tabId: string) => {
    const note = openNotes.find((item) => item.id === tabId);
    // Closing the note or file being read returns to the Notes and Files grid
    // rather than dropping the user on the Welcome screen.
    const returnsToGrid = selectedTab === tabId && (Boolean(note) || tabId === 'attachment');
    const gridReturnPath = note?.path ?? (tabId === 'attachment' ? attachment?.path : undefined);
    if (note) {
      if (note.content !== note.saved && !window.confirm(`Discard unsaved changes to ${note.title}?`)) return;
      setOpenNotes((current) => current.filter((item) => item.id !== tabId));
    } else if (tabId === 'tasks') setTaskTabOpen(false);
    else if (tabId === 'reminders') setReminderTabOpen(false);
    else if (tabId === 'calendar') setCalendarTabOpen(false);
    else if (tabId === 'assets') {
      if (assetBusy) {
        setStatusMessage('Wait for the cognitive asset operation to finish.');
        return;
      }
      if (assetDirty && !window.confirm('Discard unsaved cognitive asset changes?')) return;
      setAssetTabOpen(false);
      setAssetDirty(false);
      setAssetBusy(false);
      setAssetInitialPath(undefined);
    } else if (tabId === 'attachment') setAttachment(null);
    setPinnedTabs((current) => new Set([...current].filter((id) => id !== tabId)));
    if (returnsToGrid) {
      const notebook = findEntry(vault?.entries ?? [], selectedNotebookPath ?? null);
      setSelectedTab('notes-files');
      announceNavigation(notebook ? `Notes and Files in ${notebook.name}` : 'Notes and Files');
      setPendingGridFocusPath(gridReturnPath ?? null);
    } else {
      if (selectedTab === tabId) setSelectedTab('notes-files');
      setPendingFocus('tabs');
    }
  };

  const handleContextCommand = async (commandId: CommandId) => {
    const request = contextMenu;
    if (!request) return;
    if (commandId === 'annotate-pdf-selection' || commandId === 'annotate-current-semantic-element') {
      window.setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent(commandId, { detail: { range: request.selectionRange, element: request.invoker } }),
        );
      }, 0);
      return;
    }
    if (commandId === 'context-delete-library' && request.path) {
      const name =
        vault?.path === request.path
          ? vault.name
          : (recentLibraries.find((library) => library.path === request.path)?.name ??
            request.path.split('/').at(-1) ??
            request.path);
      setDeleteLibraryTarget({ name, path: request.path, permanent: false });
      return;
    }
    const entry = request.path ? findEntry(vault?.entries ?? [], request.path) : undefined;
    if (commandId === 'import-file' && entry && isInternallySupportedPath(entry.path)) {
      const importer = window.a11yNotebook?.vault;
      if (!importer?.importEntry) {
        setStatusMessage('Document import is unavailable.');
        return;
      }
      const root = vaultPathRef.current;
      const generation = vaultGenerationRef.current;
      try {
        const imported = await importer.importEntry(entry.path);
        if (
          switchingRef.current ||
          vaultPathRef.current !== root ||
          securityLockedRef.current ||
          vaultGenerationRef.current !== generation
        )
          return;
        if (!imported) return;
        setVault(imported.vault);
        const created = findEntry(imported.vault.entries, imported.path);
        if (created) await openEntry(created);
        const kind =
          created && /\.csv$/i.test(created.path)
            ? 'a spreadsheet'
            : created && assetRegistry.resolve(created.path)
              ? 'a cognitive tool'
              : created?.kind === 'note'
                ? 'an editable note'
                : 'a read-only preview';
        setStatusMessage(`Document imported as ${kind}. The original file was kept.`);
      } catch (failure) {
        if (!securityLockedRef.current && vaultPathRef.current === root && vaultGenerationRef.current === generation)
          setStatusMessage(`Could not import this document: ${(failure as Error).message}`);
      }
    } else if (commandId === 'import-file') {
      // No usable library entry: a menu opened without one, or the entry
      // changed since the menu opened. Fall back to the file-picker import.
      handleCommand('import-file');
      return;
    } else if ((commandId === 'context-open-with' || commandId === 'context-open-with-default') && entry) {
      try {
        const result = await window.a11yNotebook?.vault.openWith?.(entry.path, {
          makeDefault: commandId === 'context-open-with-default',
        });
        if (!result) setStatusMessage('Open With is unavailable.');
        else if (result.settingsOpened) setStatusMessage('Windows default application settings opened.');
      } catch {
        setStatusMessage('Could not open the application chooser.');
      }
    } else if (commandId === 'export-current-note' && entry?.kind === 'note') {
      await beginExport(entry.path);
    } else if (commandId === 'context-open' && request.context === 'reader-link' && request.href) {
      await openLinkTarget(request.href);
    } else if (commandId === 'context-open' && request.context === 'annotation') {
      request.invoker.querySelector<HTMLButtonElement>('button[aria-label^="Jump to annotation"]')?.click();
    } else if (commandId === 'context-delete' && request.context === 'annotation') {
      request.invoker.querySelector<HTMLButtonElement>('button[aria-label^="Delete annotation"]')?.click();
    } else if (commandId === 'context-delete' && request.context === 'reminder') {
      Array.from(request.invoker.querySelectorAll<HTMLButtonElement>('button'))
        .find((button) => /dismiss/i.test(button.textContent ?? ''))
        ?.click();
    } else if (commandId === 'context-open' && entry) {
      await openEntry(entry);
    } else if (commandId === 'context-open-external') {
      if (request.context === 'reader-link' && request.href) await window.a11yNotebook?.vault.openUrl(request.href);
      else if (request.path) await window.a11yNotebook?.vault.openExternal(request.path);
    } else if (commandId === 'context-copy-link' && request.href) {
      try {
        await navigator.clipboard.writeText(request.href);
        setStatusMessage('Link copied.');
      } catch {
        setStatusMessage('Could not copy the link.');
      }
    } else if (commandId === 'context-reveal' && request.context === 'tab' && request.tabId) {
      const note = openNotes.find((item) => item.id === request.tabId);
      if (note) {
        void window.a11yNotebook?.vault
          .reveal(note.path)
          ?.catch(() => setStatusMessage('Could not open the selected item.'));
      } else {
        setStatusMessage('Open a note before revealing it.');
      }
    } else if (commandId === 'context-protect' && entry) {
      const bridge = window.a11yNotebook?.vault;
      if (!bridge?.setProtection) {
        setStatusMessage('Protection is unavailable.');
        return;
      }
      try {
        const updated = await bridge.setProtection(entry.path, !entry.protected);
        setVault(updated);
        setStatusMessage(entry.protected ? `Unprotected ${entry.name}.` : `Protected ${entry.name}.`);
      } catch {
        setStatusMessage('Could not change protection for this item.');
      }
    } else if (commandId === 'context-properties' && entry) {
      setPropertiesPath(entry.path);
    } else if (commandId === 'context-email-item' && entry) {
      if (entry.kind === 'notebook') {
        setStatusMessage('A notebook cannot be attached. Choose a note or file.');
        return;
      }
      const bridge = window.a11yNotebook?.vault;
      if (!bridge?.emailItem) {
        setStatusMessage('Sending by email is unavailable.');
        return;
      }
      try {
        await bridge.emailItem(entry.path);
        setStatusMessage(`Opened a new email with ${entry.name} attached.`);
      } catch {
        setStatusMessage('Could not open the mail app.');
      }
    } else if (commandId === 'edit-link' && entry?.kind === 'link') {
      await openEditLinkDialog(entry);
    } else if (
      entry &&
      (request.context.startsWith('tree-') || request.context === 'attachment' || request.context === 'link') &&
      [
        'context-rename',
        'context-move',
        'context-delete',
        'context-reveal',
        'context-bookmark',
        'context-new-note',
      ].includes(commandId)
    ) {
      const actions: Partial<Record<CommandId, TreeAction>> = {
        'context-rename': 'rename',
        'context-move': 'move',
        'context-delete': 'delete',
        'context-reveal': 'reveal',
        'context-bookmark': 'bookmark',
        'context-new-note': 'new-note',
      };
      const action = actions[commandId];
      if (action) handleTreeAction(entry, action);
    } else if (commandId === 'context-close-tab' && request.tabId) {
      closeContextTab(request.tabId);
    } else if (commandId === 'context-close-other-tabs' && request.tabId) {
      const retained = (id: string) => id === request.tabId || pinnedTabs.has(id);
      const dirty = openNotes.filter((note) => !retained(note.id) && note.content !== note.saved);
      if (dirty.length && !window.confirm('Discard changes in the other open notes?')) return;
      setOpenNotes((current) => current.filter((note) => retained(note.id)));
      setTaskTabOpen(retained('tasks') && taskTabOpen);
      setReminderTabOpen(retained('reminders') && reminderTabOpen);
      setAssetTabOpen(retained('assets') && assetTabOpen);
      if (!retained('attachment')) setAttachment(null);
      setSelectedTab(request.tabId);
    } else if (commandId === 'context-pin-tab' && request.tabId) {
      setPinnedTabs((current) => {
        const next = new Set(current);
        if (next.has(request.tabId!)) next.delete(request.tabId!);
        else next.add(request.tabId!);
        return next;
      });
    } else if (commandId === 'context-cut' || commandId === 'context-copy') {
      try {
        await navigator.clipboard.writeText(request.selection ?? '');
      } catch {
        setStatusMessage('Clipboard access is unavailable.');
        return;
      }
      if (commandId === 'context-cut') {
        if (request.invoker instanceof HTMLTextAreaElement || request.invoker instanceof HTMLInputElement) {
          request.invoker.setRangeText('', request.selectionStart ?? 0, request.selectionEnd ?? 0, 'start');
          request.invoker.dispatchEvent(new Event('input', { bubbles: true }));
        } else if (request.selectionRange) {
          request.selectionRange.deleteContents();
          request.invoker.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteByCut' }));
        }
      }
    } else if (commandId === 'context-paste') {
      try {
        request.invoker.focus();
        if (request.invoker instanceof HTMLTextAreaElement || request.invoker instanceof HTMLInputElement) {
          const text = await navigator.clipboard.readText();
          request.invoker.setRangeText(
            text,
            request.selectionStart ?? request.selectionEnd ?? 0,
            request.selectionEnd ?? 0,
            'end',
          );
          request.invoker.dispatchEvent(new Event('input', { bubbles: true }));
        } else {
          const clipboardItems = await navigator.clipboard.read();
          const clipboardItem = clipboardItems[0];
          const contentType = clipboardItem?.types.includes('text/html') ? 'text/html' : 'text/plain';
          const blob = clipboardItem ? await clipboardItem.getType(contentType) : null;
          const value = blob ? await blob.text() : await navigator.clipboard.readText();
          const html = contentType === 'text/html';
          const currentSelection = document.getSelection();
          if (request.selectionRange && currentSelection) {
            const range = request.selectionRange;
            range.deleteContents();
            if (html) {
              const template = document.createElement('template');
              template.innerHTML = sanitizeNoteHtml(value, request.path);
              range.insertNode(template.content);
            } else range.insertNode(document.createTextNode(value));
            range.collapse(false);
            currentSelection.removeAllRanges();
            currentSelection.addRange(range);
            request.invoker.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste' }));
          } else
            document.execCommand(
              html ? 'insertHTML' : 'insertText',
              false,
              html ? sanitizeNoteHtml(value, request.path) : value,
            );
        }
      } catch {
        setStatusMessage('Clipboard access is unavailable.');
      }
    } else if (
      commandId === 'context-toggle-task' ||
      commandId === 'context-set-due-date' ||
      commandId === 'context-set-priority' ||
      commandId === 'context-open-source' ||
      commandId === 'context-link-task-note' ||
      commandId === 'context-link-task-file' ||
      commandId === 'context-link-task-notebook'
    ) {
      const task = tasks.find(
        (item) =>
          item.path === request.path &&
          (item.taskId
            ? item.taskId === request.invoker.closest<HTMLElement>('[data-task-id]')?.dataset.taskId
            : String(item.line) === request.invoker.closest<HTMLElement>('[data-task-line]')?.dataset.taskLine),
      );
      if (!task || !window.a11yNotebook) return;
      if (commandId === 'context-link-task-note') setTaskLinkDialog({ task, kind: 'note' });
      else if (commandId === 'context-link-task-file') setTaskLinkDialog({ task, kind: 'file' });
      else if (commandId === 'context-link-task-notebook') setTaskLinkDialog({ task, kind: 'notebook' });
      else if (commandId === 'context-toggle-task') await toggleTask(task);
      else if (commandId === 'context-open-source') {
        const source = findEntry(vault?.entries ?? [], task.path);
        if (source) await openEntry(source);
      } else if (commandId === 'context-set-due-date') {
        if (openNotes.some((note) => note.path === task.path && note.content !== note.saved) || activeConflict) {
          setStatusMessage('Save or resolve note changes before changing this task.');
          return;
        }
        setTaskScheduleDialog(task);
      } else {
        if (openNotes.some((note) => note.path === task.path && note.content !== note.saved) || activeConflict) {
          setStatusMessage('Save or resolve note changes before changing this task.');
          return;
        }
        setTaskPriorityDialog(task);
      }
    } else if (commandId === 'context-encrypt-note' && entry?.kind === 'note' && securityEnabled) {
      setNotePasswordDialog({ action: 'encrypt', entry });
    } else if (
      request.invoker.isContentEditable &&
      (commandId.startsWith('format-') || commandId === 'insert-link' || commandId === 'insert-table')
    ) {
      request.invoker.focus();
      const action =
        commandId === 'format-bold'
          ? 'bold'
          : commandId === 'format-italic'
            ? 'italic'
            : commandId === 'format-heading1'
              ? 'h1'
              : commandId === 'format-heading2'
                ? 'h2'
                : commandId === 'format-heading3'
                  ? 'h3'
                  : commandId === 'format-heading4'
                    ? 'h4'
                    : commandId === 'format-heading5'
                      ? 'h5'
                      : commandId === 'format-heading6'
                        ? 'h6'
                        : commandId === 'format-bullet'
                          ? 'insertUnorderedList'
                          : commandId === 'format-numbered'
                            ? 'insertOrderedList'
                            : commandId === 'format-quote'
                              ? 'blockquote'
                              : commandId === 'format-code'
                                ? 'pre'
                                : '';
      if (commandId === 'insert-link') {
        const url = window.prompt('Link address');
        if (url) document.execCommand('createLink', false, url);
      } else if (commandId === 'insert-table') {
        document.execCommand(
          'insertHTML',
          false,
          '<table><thead><tr><th scope="col">Column 1</th><th scope="col">Column 2</th></tr></thead><tbody><tr><td></td><td></td></tr></tbody></table>',
        );
      } else if (/^h[1-6]$/.test(action) || action === 'blockquote' || action === 'pre') {
        document.execCommand('formatBlock', false, action);
      } else if (action) document.execCommand(action);
      request.invoker.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    } else if (commandId.startsWith('format-') || commandId === 'insert-link' || commandId === 'insert-table') {
      handleCommand(commandId);
    } else if (!commandId.startsWith('context-')) {
      handleCommand(commandId);
    }
  };

  const resolveConflict = async (choice: 'mine' | 'disk' | 'copy') => {
    if (!activeConflict || !window.a11yNotebook) return;
    const note = openNotes.find((item) => item.path === activeConflict.path);
    if (!note) return;
    const bridge = window.a11yNotebook.vault;
    if (choice === 'copy') {
      const extension = /\.html?$/i.test(note.path) ? '.html' : '.md';
      const copyPath = note.path.replace(/\.(?:md|html|htm|txt)$/i, ` (conflict copy ${Date.now()})${extension}`);
      setVault(await bridge.createNote(copyPath, note.content));
      setOpenNotes((items) => items.filter((item) => item.path !== note.path));
      synchronization.clearConflict(note.path);
      await openEntry({ name: copyPath.split('/').at(-1)!, path: copyPath, kind: 'note', provenance: 'created' });
    } else {
      if (activeConflict.disk === null) throw new Error('The disk note was removed. Save a copy instead.');
      const disk = await bridge.readNote(note.path);
      if (disk !== activeConflict.disk) {
        await synchronization.checkDisk(note.path);
        throw new Error('The disk changed again. Review the latest conflict before continuing.');
      }
      const content = choice === 'mine' ? note.content : disk;
      if (choice === 'mine') {
        await bridge.saveNote(note.path, content, disk);
        clearEditLock(note.path);
      }
      // Resolving with the disk version replaces the content the
      // history was recorded against; drop it rather than let undo
      // resurrect the conflicted content. ('Mine' keeps the content,
      // so its history stays valid.)
      if (content !== note.content) invalidateEditHistory(note.id);
      setOpenNotes((items) =>
        items.map((item) => (item.path === note.path ? { ...item, content, saved: content } : item)),
      );
      synchronization.clearConflict(note.path);
    }
    setStatusMessage('Note conflict resolved.');
  };

  const saveActiveNote = async () => {
    const note = openNotes.find((item) => item.id === selectedTab);
    if (!note) {
      if (selectedTab === 'attachment' && window.a11yNotebook && spreadsheetSaveRef.current) {
        await spreadsheetSaveRef.current();
      }
      return;
    }
    if (!window.a11yNotebook || activeConflict || synchronization.checking) return;
    const contentToSave = /\.html?$/i.test(note.path) ? sanitizeNoteHtml(note.content, note.path) : note.content;
    try {
      await window.a11yNotebook.vault.saveNote(note.path, contentToSave, note.saved);
      setOpenNotes((current) =>
        current.map((item) => (item.id === note.id ? { ...item, saved: contentToSave } : item)),
      );
      clearEditLock(note.path);
      setStatusMessage(`Saved ${note.title}.`);
      await refreshVault();
      await refreshLinkIndex();
    } catch {
      setStatusMessage(`Could not save ${note.title}.`);
      await synchronization.checkDisk(note.path);
    }
  };

  const toggleTask = async (task: VaultTask, recordUndo = true) => {
    if (openNotes.some((note) => note.path === task.path && note.content !== note.saved) || activeConflict) {
      setStatusMessage('Save or resolve unsaved note changes before toggling this task.');
      return;
    }
    try {
      const updated = await window.a11yNotebook?.vault.toggleTask(
        task.path,
        task.htmlTask ? task.taskId! : task.line!,
        !task.complete,
        task.revision,
      );
      if (!updated) return;
      if (recordUndo && ((task.htmlTask && task.taskId) || task.line)) {
        taskToggleUndoRef.current.push({
          path: task.path,
          line: task.line,
          taskId: task.taskId,
          htmlTask: !!task.htmlTask,
          completeBefore: task.complete,
        });
        // A new toggle joins the timeline and clears every redo path.
        taskToggleRedoRef.current = [];
        recordTimelineAction(undoTimelineRef.current, { kind: 'toggle' });
      }
      setTasks(updated);
      const nextComplete = !task.complete;
      const note = openNotes.find((item) => item.path === task.path);
      if (note && task.htmlTask) {
        const content = await window.a11yNotebook!.vault.readNote(task.path);
        setOpenNotes((current) =>
          current.map((item) => (item.id === note.id ? { ...item, content, saved: content } : item)),
        );
        // The toggle carries its own undo entry; keep the fallback
        // snapshot chained to the toggled content.
        resyncEditSnapshot(note.id, content);
      } else if (note) {
        if (!task.line) return;
        const lines = note.content.split(/\r?\n/);
        const line = lines[task.line - 1];
        if (line) {
          lines[task.line - 1] = line.replace(/^(\s*[-*+]\s+\[)[ xX](\]\s+)/, `$1${nextComplete ? 'x' : ' '}$2`);
          const content = lines.join('\n');
          setOpenNotes((current) =>
            current.map((item) => (item.id === note.id ? { ...item, content, saved: content } : item)),
          );
          resyncEditSnapshot(note.id, content);
        }
      }
      setStatusMessage(nextComplete ? 'Task marked complete.' : 'Task marked open.');
    } catch {
      setStatusMessage('Could not update the task.');
    }
  };
  /**
   * Reverse the most recent task toggle. 'done' means the toggle was
   * reversed (and is now redoable); 'kept' means the entry was put back
   * because the note is dirty or the toggle failed, so the caller must
   * restore its timeline token; 'dropped' means the task changed since
   * it was toggled, so the entry is gone and the token is consumed;
   * 'none' means the stack was empty.
   */
  const undoLastTaskToggle = async (): Promise<'done' | 'kept' | 'dropped' | 'none'> => {
    const entry = taskToggleUndoRef.current.pop();
    if (!entry) return 'none';
    const bridge = window.a11yNotebook?.vault;
    if (!bridge?.getTasks || !bridge?.toggleTask) {
      taskToggleUndoRef.current.push(entry);
      return 'kept';
    }
    if (
      openNotes.some((note) => note.path === entry.path && note.content !== note.saved) ||
      activeConflict
    ) {
      taskToggleUndoRef.current.push(entry);
      setStatusMessage('Save or resolve unsaved note changes before undoing this task.');
      return 'kept';
    }
    try {
      const current = (await bridge.getTasks()).find((task) =>
        entry.htmlTask ? task.taskId === entry.taskId : task.path === entry.path && task.line === entry.line,
      );
      if (!current || current.complete === entry.completeBefore) {
        setStatusMessage('That task has changed since it was toggled, so it was not undone.');
        return 'dropped';
      }
      await toggleTask(current, false);
      taskToggleRedoRef.current.push(entry);
      setStatusMessage('Undid the task change.');
      return 'done';
    } catch {
      taskToggleUndoRef.current.push(entry);
      setStatusMessage('Could not undo the task change.');
      return 'kept';
    }
  };
  /** Re-apply the most recently undone task toggle; same contract as undo. */
  const redoLastTaskToggle = async (): Promise<'done' | 'kept' | 'dropped' | 'none'> => {
    const entry = taskToggleRedoRef.current.pop();
    if (!entry) return 'none';
    const bridge = window.a11yNotebook?.vault;
    if (!bridge?.getTasks || !bridge?.toggleTask) {
      taskToggleRedoRef.current.push(entry);
      return 'kept';
    }
    if (
      openNotes.some((note) => note.path === entry.path && note.content !== note.saved) ||
      activeConflict
    ) {
      taskToggleRedoRef.current.push(entry);
      setStatusMessage('Save or resolve unsaved note changes before redoing this task.');
      return 'kept';
    }
    try {
      const current = (await bridge.getTasks()).find((task) =>
        entry.htmlTask ? task.taskId === entry.taskId : task.path === entry.path && task.line === entry.line,
      );
      if (!current || current.complete === !entry.completeBefore) {
        setStatusMessage('That task has changed since it was toggled, so it was not redone.');
        return 'dropped';
      }
      await toggleTask(current, false);
      taskToggleUndoRef.current.push(entry);
      setStatusMessage('Redid the task change.');
      return 'done';
    } catch {
      taskToggleRedoRef.current.push(entry);
      setStatusMessage('Could not redo the task change.');
      return 'kept';
    }
  };
  const completeReminder = async (reminder: Reminder) => {
    if (
      switchingRef.current ||
      securityLocked ||
      openNotes.some((note) => note.path === reminder.path && note.content !== note.saved) ||
      activeConflict
    ) {
      throw new Error('Save or resolve note changes before completing this reminder.');
    }
    const path = vault?.path;
    const complete = window.a11yNotebook?.vault.completeReminder;
    if (!complete) throw new Error('Reminder completion is unavailable.');
    const updated = await complete(reminder.id, reminder.revision);
    if (vaultPathRef.current !== path || switchingRef.current) return;
    reminderState.setReminders(updated);
    const nextTasks = await window.a11yNotebook!.vault.getTasks();
    if (vaultPathRef.current !== path || switchingRef.current) return;
    setTasks(nextTasks);
    if (
      reminder.source === 'task' &&
      reminder.path !== undefined &&
      openNotes.some((note) => note.path === reminder.path)
    ) {
      const content = await window.a11yNotebook!.vault.readNote(reminder.path);
      if (vaultPathRef.current !== path || switchingRef.current) return;
      setOpenNotes((items) =>
        items.map((note) => (note.path === reminder.path ? { ...note, content, saved: content } : note)),
      );
      // Completing a reminder may rewrite its task line; keep the
      // fallback snapshot chained to the new content.
      resyncEditSnapshot(reminder.path, content);
    }
  };

  useEffect(() => {
    const note = openNotes.find((item) => item.id === selectedTab);
    if (
      !note ||
      note.content === note.saved ||
      !window.a11yNotebook ||
      activeConflict ||
      checkingDisk ||
      !settings.autosaveDelay ||
      itemDialog
    )
      return;
    const contentToSave = /\.html?$/i.test(note.path) ? sanitizeNoteHtml(note.content, note.path) : note.content;
    const timeout = window.setTimeout(() => {
      void window.a11yNotebook?.vault
        .saveNote(note.path, contentToSave, note.saved)
        .then(() => {
          setOpenNotes((current) =>
            current.map((item) => (item.id === note.id ? { ...item, saved: contentToSave } : item)),
          );
          const key = `${vault?.path ?? ''}\0${note.path}`;
          setLockedEditPaths((paths) => {
            const updated = new Set(paths);
            updated.delete(key);
            return updated;
          });
          setStatusMessage(`Saved ${note.title}.`);
          void refreshLinkIndex();
        })
        .catch(() => {
          setStatusMessage(`Could not save ${note.title}.`);
          void checkDisk(note.path);
        });
    }, settings.autosaveDelay);
    return () => window.clearTimeout(timeout);
  }, [
    openNotes,
    selectedTab,
    activeConflict,
    checkingDisk,
    checkDisk,
    settings.autosaveDelay,
    itemDialog,
    vault?.path,
  ]);

  const navigateScreen = (screen: string) => {
    setSelectedTab(screen);
    const notebook = findEntry(vault?.entries ?? [], selectedNotebookPath ?? null);
    const labels: Record<string, string> = {
      contents: 'Contents',
      libraries: vault?.name ?? 'Libraries',
      notebooks: vault ? `Notebooks in ${vault.name}` : 'Notebooks',
      'notes-files': notebook ? `Notes and Files in ${notebook.name}` : 'Notes and Files',
      tasks: 'Tasks',
      assets: 'Cognitive Tools',
      reminders: 'Reminders',
    };
    if (labels[screen]) announceNavigation(labels[screen]);
  };

  const refreshRecentLibraries = () => {
    const bridge = window.a11yNotebook?.vault;
    if (!bridge?.getRecentLibraries) return;
    void bridge
      .getRecentLibraries()
      .then(setRecentLibraries)
      .catch(() => undefined);
  };

  const openLibrary = (create = false, recentPath?: string) => {
    const bridge = window.a11yNotebook?.vault;
    if (!bridge) return;
    if (recentPath && !bridge.openLibraryPath) {
      setStatusMessage('Opening a recent library is unavailable.');
      return;
    }
    const open = recentPath ? () => bridge.openLibraryPath!(recentPath) : create ? bridge.createLibrary : bridge.open;
    if (!open) {
      setStatusMessage('Library creation is unavailable.');
      return;
    }
    if (
      assetDirty ||
      assetBusy ||
      openNotes.some((note) => note.content !== note.saved) ||
      activeConflict ||
      switchingRef.current
    ) {
      setStatusMessage('Save or resolve unsaved changes before opening another library.');
      return;
    }
    switchingRef.current = true;
    vaultGenerationRef.current += 1;
    setSwitchingVault(true);
    void open()
      .then((opened) => {
        if (opened) {
          vaultPathRef.current = opened.path;
          setVault(opened);
          setOpenNotes([]);
          setNotePasswordDialog(null);
          setAttachment(null);
          setAssetTabOpen(false);
          setAssetInitialPath(undefined);
          setAssetDirty(false);
          setSelectedTab(create ? 'libraries' : 'notebooks');
          if (!create) setPendingNotebooksGridFocus(true);
          setStatusMessage(`${create ? 'Created' : 'Opened'} library ${opened.name}.`);
          refreshRecentLibraries();
          void restoreLibraryUiState(opened);
        }
      })
      .catch(() => setStatusMessage(create ? 'Could not create the library.' : 'Could not open the selected library.'))
      .finally(() => {
        switchingRef.current = false;
        setSwitchingVault(false);
      });
  };

  // When a Quick Task library is picked, the library opens first and the
  // task dialog follows once the open library is in state.
  useEffect(() => {
    if (quickTaskStep === 'library' && vault) {
      setQuickTaskStep('task');
    }
  }, [quickTaskStep, vault]);

  const openLibraryRef = useRef(openLibrary);
  openLibraryRef.current = openLibrary;
  const navigateScreenRef = useRef(navigateScreen);
  navigateScreenRef.current = navigateScreen;

  // Read the wake focus target once on launch. The main process serves
  // it one-shot, so a second read returns null; the ref guard also
  // protects against double-invocation in development.
  const wakeFocusReadRef = useRef(false);
  useEffect(() => {
    if (wakeFocusReadRef.current) return;
    wakeFocusReadRef.current = true;
    const bridge = window.a11yNotebook?.vault;
    if (typeof bridge?.reminderWakeFocus !== 'function') return;
    void bridge
      .reminderWakeFocus()
      .then((focus) => {
        if (focus) setWakeFocus(focus);
      })
      .catch(() => undefined);
  }, []);

  // Open the wake target's library when it is not already open. On a
  // fresh wake launch no library is open, so this runs immediately;
  // if the open fails, the target simply stays pending and the user
  // lands on the normal startup view, as before.
  const wakeFocusOpenAttemptedRef = useRef(false);
  useEffect(() => {
    if (!wakeFocus || wakeFocusOpenAttemptedRef.current) return;
    if (vault?.path === wakeFocus.libraryPath) return;
    if (switchingRef.current) return;
    wakeFocusOpenAttemptedRef.current = true;
    openLibraryRef.current(false, wakeFocus.libraryPath);
  }, [wakeFocus, vault]);

  // Once the target library is open, unlocked, and its reminders have
  // loaded, show the Reminders view and queue the row focus. A missing
  // reminder is announced and the target cleared instead of focusing
  // nothing; a locked library simply waits for unlock, and focusing
  // after unlock still works because the target stays pending.
  useEffect(() => {
    if (!wakeFocus || vault?.path !== wakeFocus.libraryPath || securityLocked || !reminderState.loaded) return;
    const target = reminderState.reminders.find((item) => item.id === wakeFocus.reminderId);
    if (!target) {
      setStatusMessage('The due reminder is no longer available.');
      setWakeFocus(null);
      return;
    }
    setReminderTabOpen(true);
    navigateScreenRef.current('reminders');
    setPendingWakeFocusId(wakeFocus.reminderId);
    setWakeFocus(null);
  }, [wakeFocus, vault, securityLocked, reminderState.loaded, reminderState.reminders]);

  // Focus the due reminder's row once the Reminders view has rendered.
  // Rows already carry data-reminder-id and tabIndex -1 in both the
  // agenda and table views. When an alert dialog is already showing
  // the due reminder, it keeps focus instead: focusing a row behind
  // a modal would fight the dialog.
  useEffect(() => {
    if (!pendingWakeFocusId || selectedTab !== 'reminders') return;
    const id = pendingWakeFocusId;
    setPendingWakeFocusId(null);
    if (document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]')) return;
    const row = Array.from(document.querySelectorAll('[data-reminder-id]')).find(
      (element) => element.getAttribute('data-reminder-id') === id,
    );
    if (!(row instanceof HTMLElement)) return;
    row.focus();
    const item = reminderState.reminders.find((entry) => entry.id === id);
    if (item) setStatusMessage(`Due reminder: ${item.title}, ${new Date(item.scheduledAt).toLocaleString()}`);
  }, [pendingWakeFocusId, selectedTab, reminderState.reminders]);

  // Focus a task or reminder opened from a search result once its view
  // has rendered. Task and reminder rows already carry data-task-id /
  // data-reminder-id and tabIndex -1; the opener resets the task filters
  // first, so the row is present. Like the wake focus above, a dialog
  // already on screen keeps focus instead.
  useEffect(() => {
    if (!pendingSearchFocus || selectedTab !== pendingSearchFocus.tab) return;
    const { tab, id, announce } = pendingSearchFocus;
    setPendingSearchFocus(null);
    if (document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]')) return;
    const attribute = tab === 'tasks' ? 'data-task-id' : 'data-reminder-id';
    const row = Array.from(document.querySelectorAll(`[${attribute}]`)).find(
      (element) => element.getAttribute(attribute) === id,
    );
    if (!(row instanceof HTMLElement)) return;
    row.focus();
    setStatusMessage(announce);
  }, [pendingSearchFocus, selectedTab, tasks, reminderState.reminders]);

  const createContextual = () => {
    if (selectedTab === 'libraries') {
      openLibrary(true);
      return;
    }
    if (!vault || securityLocked) {
      setStatusMessage('Open and unlock a library before creating an item.');
      return;
    }
    if (selectedTab === 'notebooks') {
      setItemDialog({ action: 'new-notebook' });
    } else if (selectedTab === 'tasks') {
      setTaskCreationNotebookPath(
        taskNotebookFilter === 'all'
          ? selectedNotebookPath
          : taskNotebookFilter === 'Root'
            ? undefined
            : taskNotebookFilter,
      );
      setActiveDialog('new-task');
    } else if (selectedTab === 'assets') {
      if (assetBusy || assetDirty) {
        setStatusMessage('Save cognitive asset changes and wait for pending operations before creating another asset.');
        return;
      }
      setAssetCreationVersion((version) => version + 1);
    } else if (selectedTab === 'reminders') {
      openCreateReminder();
    } else if (selectedTab === 'calendar') {
      setCalendarCreateRequest((request) => request + 1);
    } else {
      void createNote();
    }
  };

  // Bibliography entries belong to a notebook: the selected notebook, or the
  // notebook holding the current note. Root-level notes have no notebook.
  const citationNotebookPath =
    selectedNotebookPath ??
    (currentNote && currentNote.path.includes('/')
      ? currentNote.path.slice(0, currentNote.path.lastIndexOf('/'))
      : undefined);

  const insertTextIntoNote = (text: string) => {
    if (!currentNote) return;
    if (document.querySelector('.rich-text-editor')) {
      window.dispatchEvent(new CustomEvent('a11y:insert-citation-text', { detail: { text } }));
      return;
    }
    const textarea = editorRef.current;
    if (textarea) {
      const start = textarea.selectionStart ?? currentNote.content.length;
      const end = textarea.selectionEnd ?? start;
      updateNoteContent(
        currentNote.id,
        `${currentNote.content.slice(0, start)}${text}${currentNote.content.slice(end)}`,
      );
      return;
    }
    updateNoteContent(currentNote.id, `${currentNote.content}\n\n${text}`);
  };

  const insertCitationText = (text: string) => {
    insertTextIntoNote(text);
    setCitationDialog(null);
    setStatusMessage('Citation inserted.');
  };

  const insertBibliography = (entries: BibliographyEntry[], style: CitationStyle) => {
    if (!currentNote) return;
    const markup = /\.html?$/i.test(currentNote.path)
      ? 'html'
      : /\.md$/i.test(currentNote.path)
        ? 'markdown'
        : 'plain';
    const text = formatBibliographyBlock(entries, style, markup);
    // In Rich text mode an HTML bibliography must be inserted as HTML, not
    // as text: the plain-text insert would show the paragraph tags on screen.
    if (markup === 'html' && document.querySelector('.rich-text-editor')) {
      window.dispatchEvent(new CustomEvent('a11y:insert-citation-html', { detail: { html: text } }));
      setCitationDialog(null);
      setStatusMessage('Bibliography inserted.');
      return;
    }
    insertTextIntoNote(text);
    setCitationDialog(null);
    setStatusMessage('Bibliography inserted.');
  };

  const insertFootnote = (entry: BibliographyEntry, page?: string) => {
    if (!currentNote) return;
    const markup = /\.html?$/i.test(currentNote.path)
      ? 'html'
      : /\.md$/i.test(currentNote.path)
        ? 'markdown'
        : 'plain';
    if (document.querySelector('.rich-text-editor')) {
      const built = buildFootnote(currentNote.content, markup, entry, page);
      const editorHtml = footnoteEditorHtml(markup, entry, page, built.number, built.shortened);
      window.dispatchEvent(new CustomEvent('a11y:insert-citation-footnote', { detail: editorHtml }));
      setCitationDialog(null);
      setStatusMessage(`Footnote ${built.number} inserted.`);
      return;
    }
    const textarea = editorRef.current;
    const caret = textarea ? (textarea.selectionStart ?? currentNote.content.length) : currentNote.content.length;
    const result = insertFootnoteAtCaret(currentNote.content, markup, entry, page, caret);
    noteCaretRef.current[currentNote.id] = { start: result.caret, end: result.caret };
    updateNoteContent(currentNote.id, result.content, 'edit');
    setCitationDialog(null);
    setStatusMessage(`Footnote ${result.number} inserted.`);
  };

  /** Insert text at the editor caret, with a space when it would otherwise run into the previous word. */
  const insertTextAtCaret = (text: string) => {
    const note = currentNote;
    if (!note) return;
    const textarea = editorRef.current;
    const caret = textarea ? (textarea.selectionStart ?? note.content.length) : note.content.length;
    const before = note.content.slice(0, caret);
    const after = note.content.slice(caret);
    const separator = before && !/\s$/.test(before) && text ? ' ' : '';
    const inserted = `${separator}${text}`;
    const end = caret + inserted.length;
    noteCaretRef.current[note.id] = { start: end, end };
    updateNoteContent(note.id, `${before}${inserted}${after}`, 'edit');
    requestAnimationFrame(() => {
      const editor = editorRef.current;
      if (editor) {
        editor.focus();
        editor.setSelectionRange(end, end);
      }
    });
  };

  const transcribeRecording = async (
    recording: FinishedRecording,
    modelId: TranscriptionModelOption['id'],
  ) => {
    const transcriber = dictationTranscriberRef.current ?? new LocalTranscriber();
    dictationTranscriberRef.current = transcriber;
    if (transcriber.loadedModelId !== modelId) {
      setStatusMessage('Downloading the transcription model. This happens once.');
    } else {
      setStatusMessage('Transcribing your dictation. This runs on your machine.');
    }
    try {
      const text = await transcriber.transcribe(recording.blob, modelId);
      if (!text) {
        setStatusMessage('Nothing was transcribed. Try speaking closer to the microphone.');
        return;
      }
      insertTextAtCaret(text);
      setStatusMessage('Dictation inserted.');
    } catch {
      setStatusMessage('Dictation could not be transcribed. Your recording was not saved.');
    }
  };

  /** An AudioRecorder wired to the real microphone and MediaRecorder. */
  const createRealRecorder = (
    onFinished: (recording: FinishedRecording) => void,
    onError: (message: string) => void,
  ) =>
    new AudioRecorder(
      {
        getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
        createRecorder: (stream, options) => {
          const mediaRecorder = new MediaRecorder(
            stream as MediaStream,
            options.mimeType ? { mimeType: options.mimeType } : undefined,
          );
          const wrapped: {
            mimeType: string;
            ondataavailable: ((event: { data: Blob }) => void) | null;
            onstop: (() => void) | null;
            onerror: ((event: { error?: { message?: string } }) => void) | null;
            start: () => void;
            stop: () => void;
          } = {
            mimeType: mediaRecorder.mimeType,
            ondataavailable: null,
            onstop: null,
            onerror: null,
            start: () => mediaRecorder.start(),
            stop: () => mediaRecorder.stop(),
          };
          mediaRecorder.ondataavailable = (event) => wrapped.ondataavailable?.({ data: event.data });
          mediaRecorder.onstop = () => wrapped.onstop?.();
          mediaRecorder.onerror = (event) =>
            wrapped.onerror?.({ error: { message: event.error?.message ?? 'Recording failed.' } });
          return wrapped;
        },
        isTypeSupported: (mimeType) => MediaRecorder.isTypeSupported(mimeType),
      },
      onFinished,
      onError,
    );

  const startDictation = async (modelId: TranscriptionModelOption['id']) => {
    const recorder = createRealRecorder(
      (recording) => {
        void transcribeRecording(recording, modelId);
      },
      (message) => {
        setDictationActive(false);
        setStatusMessage(`Dictation stopped: ${message}`);
      },
    );
    dictationRecorderRef.current = recorder;
    await recorder.start();
    if (recorder.status === 'recording') {
      setDictationActive(true);
      setStatusMessage('Dictating. Press Ctrl+Alt+D again to stop.');
    }
  };

  const toggleDictation = () => {
    if (dictationActive) {
      dictationRecorderRef.current?.stop();
      setDictationActive(false);
      setStatusMessage('Stopping dictation.');
      return;
    }
    if (!currentNote || mode !== 'edit') {
      setStatusMessage('Open a note in edit mode to dictate.');
      return;
    }
    if (currentNoteProtected || currentNoteEditLocked) {
      setStatusMessage('This note cannot be edited, so dictation is unavailable here.');
      return;
    }
    if (!settings.transcriptionModel) {
      dictationStartPendingRef.current = true;
      setTranscriptionModelChoiceOpen(true);
      return;
    }
    void startDictation(settings.transcriptionModel);
  };

  const chooseTranscriptionModel = async (optionId: TranscriptionModelOption['id']) => {
    setTranscriptionModelChoiceOpen(false);
    const saved = await persistSettings({ ...settings, transcriptionModel: optionId });
    if (!saved) return;
    if (dictationStartPendingRef.current) {
      dictationStartPendingRef.current = false;
      if (currentNote && mode === 'edit') void startDictation(optionId);
    }
    const pendingAudio = transcribePendingRef.current;
    if (pendingAudio) {
      transcribePendingRef.current = null;
      void transcribeAudio(pendingAudio);
    }
  };

  const saveAudioNote = async (recording: FinishedRecording, notebookPath: string) => {
    const bridge = window.a11yNotebook?.vault;
    if (!bridge?.saveAudioRecording) {
      setStatusMessage('Saving audio notes is unavailable in this build.');
      return;
    }
    try {
      const savedPath = await saveRecording(bridge, notebookPath, recording);
      await refreshVault();
      setAttachment({ path: savedPath, text: '', kind: recording.extension });
      setSelectedTab('attachment');
      setStatusMessage('Audio note saved.');
    } catch {
      setStatusMessage('Could not save the audio note.');
    }
  };

  const toggleRecordAudioNote = () => {
    if (audioNoteRecording) {
      audioNoteRecorderRef.current?.stop();
      setAudioNoteRecording(false);
      setStatusMessage('Stopping the recording.');
      return;
    }
    if (!vault) {
      setStatusMessage('Open a library before recording an audio note.');
      return;
    }
    const notebookPath = selectedNotebookPath ?? '';
    const recorder = createRealRecorder(
      (recording) => {
        void saveAudioNote(recording, notebookPath);
      },
      (message) => {
        setAudioNoteRecording(false);
        setStatusMessage(`Recording stopped: ${message}`);
      },
    );
    audioNoteRecorderRef.current = recorder;
    void recorder.start().then(() => {
      if (recorder.status === 'recording') {
        setAudioNoteRecording(true);
        setStatusMessage('Recording audio note. Use the Record audio note command again to stop.');
      }
    });
  };

  /** Path of the transcript note for an audio file, or null when none exists yet. */
  const transcriptForAudio = (audioPath: string): string | null => {
    const candidate = transcriptPathForAudio(audioPath);
    return flattenEntries(vault?.entries ?? []).some((entry) => entry.path === candidate) ? candidate : null;
  };

  const transcribeAudio = async (audioPath: string) => {
    const bridge = window.a11yNotebook?.vault;
    if (!bridge?.readAudioData || !bridge.createNote || !bridge.saveNote) {
      setStatusMessage('Transcription is unavailable in this build.');
      return;
    }
    const modelId = settings.transcriptionModel;
    if (!modelId) {
      transcribePendingRef.current = audioPath;
      setTranscriptionModelChoiceOpen(true);
      return;
    }
    setTranscribingAudio(true);
    setStatusMessage('Transcribing this audio file. This runs on your machine.');
    try {
      const { data } = await bridge.readAudioData(audioPath);
      const transcriber = dictationTranscriberRef.current ?? new LocalTranscriber();
      dictationTranscriberRef.current = transcriber;
      const bytes = new Uint8Array(data);
      const blob = new Blob([bytes.buffer], { type: audioMimeType(audioPath) || 'audio/webm' });
      const text = await transcriber.transcribe(blob, modelId);
      if (!text) {
        setStatusMessage('Nothing was transcribed from this audio file.');
        return;
      }
      const transcriptPath = transcriptPathForAudio(audioPath);
      const content = transcriptNoteContent(audioPath.split('/').at(-1) ?? audioPath, text);
      if (transcriptForAudio(audioPath)) {
        await bridge.saveNote(transcriptPath, content);
      } else {
        await bridge.createNote(transcriptPath, content);
      }
      await refreshVault();
      setStatusMessage(`Transcript saved as ${transcriptPath.split('/').at(-1)}.`);
    } catch {
      setStatusMessage('Could not transcribe this audio file.');
    } finally {
      setTranscribingAudio(false);
    }
  };

  const handleCommand = (commandId: CommandId) => {
    if (switchingRef.current || securityLockedRef.current) return;
    clearTimeout(navigationAnnouncementTimer.current);
    // While the citation dialog is open, its own view commands still work:
    // they switch the dialog between the generator and the bibliography.
    // Its switch-to-edit action also works: it flips the mode from inside
    // the dialog. Keyboard and menu paths still cannot reach the mode
    // toggle while a dialog is open (their own guards stand), so only the
    // dialog's own action passes here.
    const switchingCitationView =
      citationDialog &&
      (commandId === 'open-citation-generator' || commandId === 'open-bibliography');
    const switchingToEditFromCitation = citationDialog && commandId === 'toggle-read-only-mode';
    if (
      !switchingCitationView &&
      !switchingToEditFromCitation &&
      ((activeDialog && activeDialog !== 'palette') ||
        itemDialog ||
        organizeOpen ||
        taskDialogOpen ||
        quickTaskStep ||
        linkDialog ||
        spellingOpen ||
        thesaurusRequest ||
        citationDialog ||
        externalFile ||
        notePasswordDialog ||
        activeConflict ||
        exportRequest)
    )
      return;
    if (commandId === 'open-citation-generator' || commandId === 'open-bibliography') {
      if (!currentNote || !citationNotebookPath) {
        setStatusMessage('Open a note in a notebook first.');
        return;
      }
      if (commandId === 'open-citation-generator' && mode !== 'edit' && !citationDialog) {
        setStatusMessage('Open a note in a notebook in edit mode first.');
        return;
      }
      setCitationDialog(commandId === 'open-citation-generator' ? 'generator' : 'bibliography');
      return;
    }
    if (commandId === 'new-contextual') {
      if (activeDialog === 'palette') setActiveDialog(null);
      createContextual();
      return;
    }
    if (commandId === 'new-note') {
      if (activeDialog === 'palette') setActiveDialog(null);
      if (selectedTab === 'reminders') {
        openCreateReminder();
        return;
      }
      void createNote();
      return;
    }
    if (commandId === 'create-reminder') {
      // From a context menu this is the note or file the menu was opened
      // on; from anywhere else there is no path to pre-select.
      openCreateReminder(contextMenu?.path);
      return;
    }
    if (commandId === 'new-task') {
      if (!vault) {
        setStatusMessage('Open a library before creating a task.');
        return;
      }
      setActiveDialog(null);
      setTaskCreateError('');
      setTaskNotePaths([]);
      setTaskCreating(true);
      setTaskDialogOpen(true);
      const root = vaultPathRef.current;
      const generation = vaultGenerationRef.current;
      const isCurrent = () =>
        !securityLockedRef.current &&
        !switchingRef.current &&
        root === vaultPathRef.current &&
        generation === vaultGenerationRef.current;
      void Promise.all(
        notePaths.map(async (path) => ({
          path,
          encrypted: (await window.a11yNotebook?.vault.isNoteEncrypted?.(path)) ?? false,
        })),
      )
        .then((notes) => {
          if (isCurrent()) setTaskNotePaths(notes.filter((note) => !note.encrypted).map((note) => note.path));
        })
        .catch(() => {
          if (isCurrent()) setTaskCreateError('Could not inspect eligible notes. Close this dialog and try again.');
        })
        .finally(() => {
          if (isCurrent()) setTaskCreating(false);
        });
      return;
    }
    if (commandId === 'new-asset') {
      if (!vault || assetDirty || assetBusy) {
        setStatusMessage('Open a library and save cognitive asset changes before creating another tool.');
        return;
      }
      setActiveDialog(null);
      setAssetTabOpen(true);
      setSelectedTab('assets');
      setAssetCreationVersion((version) => version + 1);
      return;
    }
    if (commandId === 'capture-webpage') {
      if (vault && !openNotes.some((note) => note.content !== note.saved)) setActiveDialog('web-capture');
      else setStatusMessage('Save open notes and open a library before capturing a webpage.');
      return;
    }
    if (commandId === 'reveal-selected') {
      if (treeSelection) void window.a11yNotebook?.vault.reveal(treeSelection);
      else setStatusMessage('Select an item before revealing it.');
      return;
    }
    if (commandId === 'encrypt-current-note') {
      if (currentNote && securityEnabled && encryptedNotePath !== currentNote.path) {
        setNotePasswordDialog({
          action: 'encrypt',
          entry: {
            name: currentNote.title,
            path: currentNote.path,
            kind: 'note',
            provenance: 'created',
          },
        });
      }
      return;
    }
    if (commandId === 'convert-current-note') {
      if (currentNote && mode === 'edit' && currentNote.path !== encryptedNotePath) void convertActiveNoteFormat();
      return;
    }
    if (commandId === 'convert-note-to-outline') {
      if (currentNote && currentNote.path !== encryptedNotePath) void convertActiveNoteToOutline();
      return;
    }
    if (commandId === 'insert-attachment') {
      if (!currentNote || mode !== 'edit') {
        setStatusMessage('Open a note in edit mode first.');
        return;
      }
      setActiveDialog('attachment-insert');
      return;
    }
    if (commandId !== 'command-search' && activeDialog === 'palette') setActiveDialog(null);
    if (commandId === 'import-file') {
      // In the Notes and Files view the notebook was already chosen to enter the
      // view, so import into it instead of demanding a fresh tree selection.
      const selectedEntry = findEntry(vault?.entries ?? [], treeSelection);
      const targetNotebook =
        selectedEntry?.kind === 'notebook'
          ? selectedEntry.path
          : selectedTab === 'notes-files'
            ? selectedNotebookPath
            : undefined;
      if (targetNotebook && window.a11yNotebook)
        void window.a11yNotebook.vault
          .importFile(targetNotebook)
          .then((updated) => {
            if (!updated) return;
            if ('pointer' in updated) {
              // A Google link-pointer file: offer "Add as link" with the
              // URL read from the file, alongside the guidance for the
              // download-and-import path shown in the dialog.
              setLinkDialog({
                mode: 'add',
                notebookPath: targetNotebook,
                initialUrl: updated.pointer.url,
                guidance: updated.pointer.guidance,
              });
              return;
            }
            if ('pointerFailed' in updated) {
              // The link-pointer file could not be read, so its URL is
              // unknown: still offer "Add as link" with an empty address
              // for the user to paste, alongside the guidance and the
              // specific reason the file could not be read.
              const failed = updated.pointerFailed;
              const code = failed.code ? ` (${failed.code})` : '';
              setLinkDialog({
                mode: 'add',
                notebookPath: targetNotebook,
                initialUrl: '',
                guidance: `${failed.guidance} ${failed.reason}${code} You can still add it as a link: paste the document's web address below.`,
              });
              return;
            }
            setVault(updated);
          })
          .catch((failure) => {
            // Surface the .gdoc and export-guidance messages, not a
            // generic message: the main process throws them for
            // Google Docs link files and for formats the app cannot
            // read, and a generic message hides them. Other import
            // failures keep the generic lead-in but append the real
            // underlying reason (for example the spreadsheet or ZIP
            // error), so a failure is diagnosable. Strip the Electron
            // IPC wrapper first, as in the updater's error cleaning.
            const raw = failure instanceof Error ? failure.message : '';
            const cleaned = raw.replace(/^Error invoking remote method '[^']*':\s*(?:Error:\s*)?/, '');
            const isGuidance =
              cleaned.includes('.gdoc') ||
              cleaned.includes('cannot be read by this app') ||
              cleaned.includes('only a link to an online');
            setStatusMessage(
              isGuidance
                ? cleaned
                : cleaned
                  ? `Could not import the selected file. ${cleaned}`
                  : 'Could not import the selected file.',
            );
          });
      else setStatusMessage('Select a notebook before importing a file.');
      return;
    }
    if (commandId === 'open-selected-external') {
      if (isCommandDisabled(commandId) || !treeSelection) {
        setStatusMessage('Select a file before opening it externally.');
        return;
      }
      void window
        .a11yNotebook!.vault.openExternal(treeSelection)
        .catch(() => setStatusMessage('Could not open the selected file externally.'));
      return;
    }
    if (commandId === 'show-settings') {
      setActiveDialog('settings');
      return;
    }
    if (commandId === 'check-spelling-grammar') {
      if (!currentNote || mode !== 'edit' || currentNoteEditLocked) {
        setStatusMessage('Open a note in edit mode first.');
        return;
      }
      setSpellingOpen(true);
      return;
    }
    if (commandId === 'open-thesaurus') {
      if (!currentNote) {
        setStatusMessage('Open a note first.');
        return;
      }
      setThesaurusRequest(captureThesaurusRequest());
      return;
    }
    if (commandId === 'export-current-note') {
      if (currentNote) void beginExport(currentNote.path);
      else setStatusMessage('Open a note before exporting.');
      return;
    }
    if (commandId === 'show-reminders') {
      setReminderTabOpen(true);
      navigateScreen('reminders');
      return;
    }
    if (commandId === 'show-calendar') {
      if (activeDialog === 'palette') setActiveDialog(null);
      if (!vault || securityLocked || switchingRef.current) {
        setStatusMessage('Open and unlock a library before using the calendar.');
        return;
      }
      setCalendarTabOpen(true);
      setSelectedTab('calendar');
      if (document.activeElement === tabPanelRef.current) announceNavigation('Calendar');
      else setPendingFocus('main');
      return;
    }
    if (commandId === 'show-assets') {
      setAssetTabOpen(true);
      navigateScreen('assets');
      return;
    }
    if (commandId === 'new-from-template') {
      if (selectedTab === 'notes-files' && !selectedNotebookPath) {
        setStatusMessage('Select a notebook before creating a note from a template.');
        return;
      }
      if (!vault) {
        setStatusMessage('Open a library before using a template.');
        return;
      }
      const root = vault.path;
      void Promise.all(
        allEntries
          .filter(
            (entry) =>
              entry.kind === 'note' &&
              isManagedEntry(entry) &&
              !assetRegistry.resolve(entry.path) &&
              entry.path.startsWith('Templates/'),
          )
          .map(async (entry) => ({
            id: `user:${entry.path}`,
            name: entry.name.replace(/\.(?:md|html|htm|txt)$/i, ''),
            content: await window.a11yNotebook!.vault.readNote(entry.path),
            format: /\.html?$/i.test(entry.path) ? ('html' as const) : ('markdown' as const),
          })),
      )
        .then((templates) => {
          if (switchingRef.current || vaultPathRef.current !== root) return;
          setUserTemplates(templates);
          setActiveDialog('template');
        })
        .catch(() => setStatusMessage('Could not load templates.'));
      return;
    }
    if (commandId === 'annotate-selection') {
      annotationTools.begin();
      return;
    }
    if (commandId === 'annotate-pdf-selection' || commandId === 'annotate-current-semantic-element') {
      if (selectedTab !== 'attachment' || !attachment?.path.toLowerCase().endsWith('.pdf')) {
        setStatusMessage('Open a PDF before adding a PDF note.');
        return;
      }
      const path = attachment.path;
      window.setTimeout(() => window.dispatchEvent(new CustomEvent(commandId, { detail: { path } })), 0);
      return;
    }
    if (commandId.startsWith('format-')) {
      if (mode !== 'edit' || !currentNote) {
        setStatusMessage('Open a note in edit mode before formatting.');
        return;
      }
      const action = commandId.slice('format-'.length) as Parameters<EditorToolsHandle['format']>[0];
      editorToolsRef.current?.format(action);
      return;
    }
    if (commandId === 'insert-link' || commandId === 'insert-table') {
      if (mode !== 'edit') {
        setStatusMessage('Switch to edit mode first.');
        return;
      }
      if (commandId === 'insert-link') editorToolsRef.current?.openLink();
      else editorToolsRef.current?.openTable();
      return;
    }
    if (commandId === 'insert-math') {
      if (mode !== 'edit' || !currentNote) {
        setStatusMessage('Switch to edit mode first.');
        return;
      }
      if (document.querySelector('.rich-text-editor')) {
        window.dispatchEvent(new CustomEvent('a11y:open-math-toolbar'));
        return;
      }
      // Plain-source editing has no rich-text toolbar: insert an empty math
      // template at the cursor (a math code span for Markdown, MathML for
      // HTML) with the caret just inside it, before the closing marker,
      // so the user types only the math itself instead of editing around
      // a prefilled example.
      const textarea = editorRef.current;
      if (!textarea) {
        setStatusMessage('Switch to rich text editing to use the Mathematics toolbar.');
        return;
      }
      const template = /\.html?$/i.test(currentNote.path) ? '<math></math>' : '`math:`';
      const start = textarea.selectionStart ?? currentNote.content.length;
      const end = textarea.selectionEnd ?? start;
      const caret = start + template.length - (template === '`math:`' ? 1 : 7);
      updateNoteContent(
        currentNote.id,
        `${currentNote.content.slice(0, start)}${template}${currentNote.content.slice(end)}`,
      );
      // The controlled textarea re-renders with the new value; place the
      // caret after that render lands, as list continuation does.
      window.setTimeout(() => {
        if (document.contains(textarea)) {
          textarea.focus();
          textarea.setSelectionRange(caret, caret);
        }
      }, 0);
      setStatusMessage('Math template inserted. Type the math inside it.');
      return;
    }
    if (commandId === 'open-vault' || commandId === 'new-library') {
      openLibrary(commandId === 'new-library');
      return;
    }
    if (commandId === 'backup-library') {
      if (!vault || !window.a11yNotebook?.vault.backupLibrary) {
        setStatusMessage('Open a library before backing it up.');
        return;
      }
      void window.a11yNotebook.vault
        .backupLibrary()
        .then((result) => {
          if (result.cancelled) setStatusMessage('Library backup cancelled.');
          else
            setStatusMessage(
              `Library backup complete: ${result.files} files copied to ${result.path}. Open that folder as a library to restore it.`,
            );
        })
        .catch(() => setStatusMessage('Could not back up the library.'));
      return;
    }
    if (commandId === 'new-notebook') {
      if (!vault || !window.a11yNotebook) {
        setStatusMessage('Open a library before creating a notebook.');
        return;
      }
      setItemDialog({ action: 'new-notebook' });
      return;
    }
    if (commandId === 'edit-note-metadata') {
      if (!currentNote) {
        setStatusMessage('Open a note to edit its metadata.');
        return;
      }
      if (/\.html?$/i.test(currentNote.path)) {
        setStatusMessage('Front-matter editing is for Markdown and text notes, not HTML notes.');
        return;
      }
      setActiveDialog('note-metadata');
      return;
    }
    if (commandId === 'refresh-links') {
      void refreshVault().then(refreshLinkIndex).then(refreshTaskLinks);
      setStatusMessage('Library and links refreshed.');
      return;
    }
    if (commandId === 'repair-broken-links') {
      setBrokenLinkFilter(null);
      void refreshLinkIndex().then(() => setActiveDialog('broken-links'));
      return;
    }
    if (commandId === 'close-current-tab') {
      // Ctrl+W closes whatever is current: a tab, then the library from the
      // Libraries view, then a selected notebook, then the library from
      // anywhere else. Closing a notebook clears its selection.
      const closableTab = tabs.some(
        (tab) => tab.id === selectedTab && !NAVIGATION_SCREENS.some((screen) => screen.id === tab.id),
      );
      if (closableTab) {
        closeContextTab(selectedTab);
      } else if (selectedTab === 'libraries' && vault) {
        closeLibrary();
      } else if (selectedNotebookPath) {
        const notebookName = findEntry(vault?.entries ?? [], selectedNotebookPath)?.name;
        setSelectedNotebookPath(undefined);
        setTreeSelection(null);
        setStatusMessage(notebookName ? `Closed notebook ${notebookName}.` : 'Notebook closed.');
      } else if (vault) {
        closeLibrary();
      } else {
        setStatusMessage('Nothing to close.');
      }
      return;
    }
    if (activeDialog === 'palette' && commandId !== 'command-search') {
      setActiveDialog(null);
    }
    if (commandId === 'toggle-read-only-mode' && !currentNote) {
      setStatusMessage('This view has no note editor. Open a managed Markdown or HTML note to enable editing.');
      return;
    }
    if (commandId === 'enable-reading-mode' && !currentNote) {
      setStatusMessage('Open a note to enable reading mode.');
      return;
    }
    if (commandId === 'find-in-document' && !currentNote && !(selectedTab === 'attachment' && attachment)) {
      setStatusMessage('Open a note or document to search within it.');
      return;
    }
    if (commandId === 'toggle-read-only-mode' && mode === 'read-only' && currentNoteEditLocked) {
      setStatusMessage('Save this note before editing it again.');
      return;
    }
    if (commandId === 'toggle-focus-mode') {
      toggleFocusMode();
      return;
    }
    if (commandId === 'edit-undo' || commandId === 'edit-redo') {
      stepEditHistory(commandId === 'edit-undo' ? 'undo' : 'redo');
      return;
    }
    if (commandId === 'context-reveal') {
      // Context commands need a target, so a shortcut assignment cannot
      // carry one: reveal the selected tree item, or the open note.
      const target = treeSelection ?? currentNote?.path;
      if (target) {
        void window.a11yNotebook?.vault
          .reveal(target)
          ?.catch(() => setStatusMessage('Could not open the selected item.'));
      } else {
        setStatusMessage('Select an item or open a note before revealing it.');
      }
      return;
    }
    if (commandId === 'organize-library') {
      if (!vault) {
        setStatusMessage('Open a library before organizing it.');
        return;
      }
      setOrganizeOpen(true);
      return;
    }
    if (commandId === 'quick-task') {
      if (activeDialog === 'palette') setActiveDialog(null);
      if (!vault) {
        setQuickTaskStep('library');
      } else {
        // The task dialog opens at once, with the text box focused first;
        // when no notebook is open it carries the notebook chooser after
        // the text box, in the same flow, instead of asking first.
        setQuickTaskStep('task');
      }
      return;
    }
    if (commandId === 'add-link') {
      if (activeDialog === 'palette') setActiveDialog(null);
      const notebookPath = linkTargetNotebook();
      if (!notebookPath) {
        setStatusMessage('Select a notebook before adding a link.');
        return;
      }
      setLinkDialog({ mode: 'add', notebookPath, initialUrl: '' });
      return;
    }
    if (commandId === 'edit-link') {
      if (activeDialog === 'palette') setActiveDialog(null);
      const entry = findEntry(vault?.entries ?? [], treeSelection);
      if (!entry || entry.kind !== 'link') {
        setStatusMessage('Select a link to edit it.');
        return;
      }
      void openEditLinkDialog(entry);
      return;
    }
    if (commandId === 'dictate') {
      if (activeDialog === 'palette') setActiveDialog(null);
      toggleDictation();
      return;
    }
    if (commandId === 'record-audio-note') {
      if (activeDialog === 'palette') setActiveDialog(null);
      toggleRecordAudioNote();
      return;
    }
    const result = dispatchCommand(commandId, {
      mode,
      rightPaneOpen,
      setMode: (nextMode) => {
        if (nextMode === 'edit' && currentNoteEditLocked) {
          setStatusMessage('Save this note before editing it again.');
          return;
        }
        if (nextMode === 'edit' && currentNoteProtected && currentNote) {
          openProtectedRequest(currentNote.path, 'edit');
          return;
        }
        // Only the mode toggle asks for edit here (reading mode asks for
        // read-only), so a flip to edit is a user request to start
        // editing: focus the editor once it renders.
        if (nextMode === 'edit' && mode === 'read-only') focusEditorOnEditRef.current = true;
        setMode(nextMode);
      },
      setRightPaneOpen,
      setCommandPaletteOpen: (open) => setActiveDialog(open ? 'palette' : null),
      setSelectedTab,
      newContextual: createContextual,
      navigateBack: goBackInHistory,
      navigateForward: goForwardInHistory,
      showContents: () => navigateScreen('contents'),
      showLibraries: () => navigateScreen('libraries'),
      showNotebooks: () => navigateScreen('notebooks'),
      showNotesFiles: () => navigateScreen('notes-files'),
      saveNote: () => void saveActiveNote(),
      showTasks: () => {
        setTaskTabOpen(true);
        navigateScreen('tasks');
      },
      toggleBookmark: () => void toggleActiveBookmark(),
      bookmarkHeadingAtCursor: () => void addAnchoredBookmark('heading'),
      bookmarkPositionAtCursor: () => void addAnchoredBookmark('position'),
      focusTarget: setPendingFocus,
      checkForUpdates,
      showKeyboardShortcuts: () => setActiveDialog('shortcuts'),
      showAbout: () => setActiveDialog('about'),
      showFeedback: () => setActiveDialog('feedback'),
      showTutorial: () => setTutorialOpen(true),
      startFind,
      repeatFind,
    });
    if (result) {
      setStatusMessage(result);
    }
  };

  // On macOS, Command is the Ctrl equivalent for every command shortcut,
  // and a physical Ctrl press never triggers one (VoiceOver's modifier).
  const isMac = window.a11yNotebook?.platform === 'darwin';
  const handleGlobalKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing || securityLockedRef.current || event.keyCode === 229) return;
    // Open dialogs manage their own keyboard interaction (Tab trapping and Escape).
    // Exception: while the citation dialog is open, its two view shortcuts
    // (Ctrl+Shift+C / Ctrl+Shift+J, or the user's remapped equivalents) still
    // switch views instead of being swallowed.
    const switchingCitationView =
      citationDialog &&
      (['open-bibliography', 'open-citation-generator'] as const).some((id) => {
        const command = COMMANDS.find((item) => item.id === id);
        return (
          command &&
          effectiveCommandShortcuts(command, settings.shortcuts, settings.shortcutAliases, isMac).some((shortcut) =>
            matchesShortcut(event, shortcut, isMac),
          )
        );
      });
    if (
      !switchingCitationView &&
      (activeDialog ||
        itemDialog ||
        activeConflict ||
        document.querySelector('[role="dialog"], [role="alertdialog"]'))
    ) {
      return;
    }
    if ((event.key === 'F10' && event.shiftKey) || event.key === 'ContextMenu') {
      event.preventDefault();
      if (document.activeElement instanceof HTMLElement) {
        const selection = document.getSelection();
        const selectedNode = selection?.anchorNode;
        const selectedElement = selectedNode instanceof HTMLElement ? selectedNode : selectedNode?.parentElement;
        const pdfContext = selectedElement?.closest<HTMLElement>('[data-context="pdf-selection"]');
        openContextMenu(
          document.activeElement === document.body && selection && !selection.isCollapsed && pdfContext
            ? pdfContext
            : document.activeElement,
        );
      }
      return;
    }
    if (event.key === 'F6' && !event.ctrlKey && !event.altKey && !event.metaKey) {
      event.preventDefault();
      const current = regionContaining(document.activeElement);
      const next = current
        ? cycleFocusRegions(current, event.shiftKey ? 'backward' : 'forward', availableRegions)
        : availableRegions.includes(activeRegion)
          ? activeRegion
          : availableRegions[0];
      focusNow(next);
      return;
    }
    if (event.key === 'Delete' && event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
      // Shift+Delete is permanent delete, mirroring the operating system
      // convention. It never runs inside a text field, where Shift+Delete
      // cuts text, and the dialog guard above keeps it out of dialogs.
      // The confirmation dialog still appears, with Delete as the first
      // (default) button and Escape cancelling.
      const inTextField =
        event.target instanceof Element &&
        event.target.closest(
          'input:not([type="checkbox"]):not([type="radio"]):not([type="button"]), textarea, select, [contenteditable="true"], [role="textbox"]',
        );
      if (inTextField || !treeSelection) return;
      event.preventDefault();
      void deleteEntryPermanently(treeSelection);
      return;
    }
    if (event.key === 'Tab' && event.ctrlKey) {
      event.preventDefault();
      if (!cycleTabs.length) {
        setStatusMessage('No open tabs to cycle to.');
        return;
      }
      const currentIndex = cycleTabs.findIndex((tab) => tab.id === selectedTab);
      const nextIndex =
        currentIndex < 0
          ? event.shiftKey
            ? cycleTabs.length - 1
            : 0
          : (currentIndex + (event.shiftKey ? -1 : 1) + cycleTabs.length) % cycleTabs.length;
      setSelectedTab(cycleTabs[nextIndex].id);
      // Switching tabs leaves focus where it was, so the landed-on
      // note or file would otherwise pass silently: announce its title.
      setStatusMessage(cycleTabs[nextIndex].label);
      return;
    }
    if (event.defaultPrevented || event.isComposing) return;
    const command = COMMANDS.find((item) =>
      effectiveCommandShortcuts(item, settings.shortcuts, settings.shortcutAliases, isMac).some((shortcut) =>
        matchesShortcut(event, shortcut, isMac),
      ),
    );
    if (command) {
      const editing =
        event.target instanceof Element &&
        event.target.closest(
          'input:not([type="checkbox"]):not([type="radio"]):not([type="button"]), textarea, select, [contenteditable="true"], [role="textbox"]',
        );
      if (
        editing &&
        [
          'new-contextual',
          'show-contents',
          'show-libraries',
          'show-notebooks',
          'show-notes-files',
          'show-tasks',
          'show-assets',
          'show-calendar',
          'show-reminders',
        ].includes(command.id)
      )
        return;

      event.preventDefault();
      handleCommand(command.id);
    }
  };

  // Always call the latest handler without re-registering the listener on every render.
  const keyDownHandlerRef = useRef(handleGlobalKeyDown);
  keyDownHandlerRef.current = handleGlobalKeyDown;
  const contextMenuHandlerRef = useRef(openContextMenu);
  contextMenuHandlerRef.current = openContextMenu;
  useEffect(() => {
    const listener = (event: KeyboardEvent) => keyDownHandlerRef.current(event);
    const contextListener = (event: MouseEvent) => {
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      const target =
        event.target instanceof HTMLElement
          ? event.target
          : event.target instanceof Node
            ? event.target.parentElement
            : null;
      if (!target) return;
      event.preventDefault();
      contextMenuHandlerRef.current(target, { x: event.clientX, y: event.clientY });
    };
    window.addEventListener('keydown', listener);
    window.addEventListener('contextmenu', contextListener);
    return () => {
      window.removeEventListener('keydown', listener);
      window.removeEventListener('contextmenu', contextListener);
    };
  }, []);

  // Commands chosen from the native Windows menu.
  const menuCommandHandlerRef = useRef(handleCommand);
  menuCommandHandlerRef.current = handleCommand;
  useEffect(() => {
    const bridge = window.a11yNotebook;
    if (!bridge) {
      return undefined;
    }
    return bridge.onMenuCommand((command) => {
      if (isMenuCommand(command) && !document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]')) {
        menuCommandHandlerRef.current(command);
      }
    });
  }, []);

  // Mirror updater announcements in the status bar. While the update dialog is open
  // it announces them itself, so the status bar is not updated to avoid double speech.
  const activeDialogRef = useRef(activeDialog);
  activeDialogRef.current = activeDialog;
  useEffect(() => {
    if (updater.announcement && activeDialogRef.current !== 'updates') {
      setStatusMessage(updater.announcement);
    }
  }, [updater.announcement]);

  const closeDialog = () => setActiveDialog(null);

  const handleTabKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number;
    switch (event.key) {
      case 'ArrowRight':
        nextIndex = (index + 1) % tabs.length;
        break;
      case 'ArrowLeft':
        nextIndex = (index - 1 + tabs.length) % tabs.length;
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = tabs.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const nextTab = tabs[nextIndex];
    setSelectedTab(nextTab.id);
    tabRefs.current[nextTab.id]?.focus();
  };

  const today = new Date().toISOString().slice(0, 10);
  const priorityOptions = resolvePriorityOptions(settings);
  const taskNotebooks = [...new Set(tasks.map(notebookForTask))];
  const visibleTasks = tasks
    .filter((task) => taskStatusFilter === 'all' || (taskStatusFilter === 'done') === task.complete)
    .filter((task) => taskNotebookFilter === 'all' || notebookForTask(task) === taskNotebookFilter)
    .filter(
      (task) =>
        taskPriorityFilter === 'all' ||
        (task.priority ?? 'medium').toLowerCase() === taskPriorityFilter.toLowerCase(),
    )
    .filter((task) => {
      if (taskDueFilter === 'any') return true;
      if (taskDueFilter === 'today') return task.dueDate === today;
      if (taskDueFilter === 'overdue') return !task.complete && Boolean(task.dueDate && task.dueDate < today);
      return !task.complete && Boolean(task.dueDate && task.dueDate > today);
    })
    .sort((left, right) => {
      if (taskSort === 'priority') {
        // Options are stored highest first; sorting uses lowest first, unknown values last.
        const order = [...priorityOptions].reverse().map((option) => option.toLowerCase());
        const rank = (priority: string | undefined) => {
          const index = order.indexOf((priority ?? 'medium').toLowerCase());
          return index < 0 ? order.length : index;
        };
        return (rank(left.priority) - rank(right.priority)) * (priorityAscending ? 1 : -1);
      }
      const leftDate = left.dueDate ?? '9999-12-31';
      const rightDate = right.dueDate ?? '9999-12-31';
      return leftDate.localeCompare(rightDate) * (dueAscending ? 1 : -1);
    });
  const openDetailsEntry = (entry: VaultEntry) => {
    if (entry.kind === 'notebook') {
      selectEntry(entry);
      setSelectedTab('notes-files');
      announceNavigation(`Notes and Files in ${entry.name}`);
      return;
    }
    void openEntry(entry).catch(() => setStatusMessage('Could not open the selected file.'));
  };
  const isCommandDisabled = (id: CommandId): boolean => {
    if (securityLocked || switchingVault) return true;
    if (id === 'import-file')
      return (
        !window.a11yNotebook ||
        !vault ||
        (findEntry(vault.entries, treeSelection)?.kind !== 'notebook' &&
          !(selectedTab === 'notes-files' && !!selectedNotebookPath))
      );
    if (id === 'add-link')
      return (
        !window.a11yNotebook ||
        !vault ||
        (findEntry(vault.entries, treeSelection)?.kind !== 'notebook' &&
          !(selectedTab === 'notes-files' && !!selectedNotebookPath))
      );
    if (id === 'edit-link') {
      const entry = findEntry(vault?.entries ?? [], treeSelection);
      return !entry || entry.kind !== 'link';
    }
    if (id === 'open-selected-external') {
      const entry = findEntry(vault?.entries ?? [], treeSelection);
      return !window.a11yNotebook || !entry || entry.kind === 'notebook';
    }
    if (id === 'toggle-read-only-mode') return !currentNote || currentNoteEditLocked;
    if (id === 'organize-library') return !vault;
    if (id === 'enable-reading-mode') return !currentNote;
    if (id === 'find-in-document')
      return !currentNote && !(selectedTab === 'attachment' && attachment);
    if (id === 'edit-undo') {
      return undoTimelineRef.current.undo.length === 0;
    }
    if (id === 'edit-redo') {
      return undoTimelineRef.current.redo.length === 0;
    }
    if (id === 'toggle-bookmark' || id === 'export-current-note') return !currentNote;
    if (id === 'bookmark-heading-at-cursor' || id === 'bookmark-position-at-cursor')
      return !currentNote || mode !== 'edit';
    if (id === 'toggle-focus-mode') return !currentNote;
    if (id === 'edit-note-metadata') return !currentNote || /\.html?$/i.test(currentNote.path);
    if (id === 'save-current-note')
      return !currentNote || (currentNote.content === currentNote.saved && !currentNoteEditLocked);
    if (id === 'close-current-tab')
      return (
        !tabs.some(
          (tab) => tab.id === selectedTab && !NAVIGATION_SCREENS.some((screen) => screen.id === tab.id),
        ) &&
        !vault &&
        !selectedNotebookPath
      );
    if (id === 'toggle-right-pane') return false;
    if (id === 'capture-webpage')
      return !vault || openNotes.some((note) => note.content !== note.saved) || !!activeConflict;
    if (id === 'reveal-selected') return !treeSelection;
    if (id === 'encrypt-current-note')
      return (
        !currentNote ||
        !securityEnabled ||
        encryptedNotePath === currentNote.path ||
        mode !== 'read-only' ||
        currentNote.content !== currentNote.saved
      );
    if (id === 'convert-current-note') return !currentNote || mode !== 'edit' || currentNote.path === encryptedNotePath;
    if (id === 'convert-note-to-outline')
      return (
        !currentNote ||
        currentNote.path === encryptedNotePath ||
        !/\.md$/i.test(currentNote.path) ||
        /\.(?:outline|cards|grid)\.md$/i.test(currentNote.path)
      );
    if (
      id.startsWith('format-') ||
      id === 'insert-link' ||
      id === 'insert-table' ||
      id === 'insert-math' ||
      id === 'insert-attachment'
    )
      return !currentNote || mode !== 'edit' || currentNoteEditLocked;
    if (id === 'check-spelling-grammar') return !currentNote || mode !== 'edit' || currentNoteEditLocked;
    if (id === 'open-thesaurus') return !currentNote;
    if (id === 'open-citation-generator')
      return !currentNote || mode !== 'edit' || currentNoteEditLocked || !citationNotebookPath;
    if (id === 'open-bibliography') return !currentNote || !citationNotebookPath;
    if (id === 'new-contextual') return isCommandDisabled(contextualNewCommand);
    if (id === 'create-reminder') return !vault || securityLocked;
    if (['context-open-with', 'context-open-with-default'].includes(id)) return true;
    if (id === 'new-asset') return !vault || assetDirty || assetBusy;
    if (id === 'new-note' || id === 'new-from-template')
      return !vault || assetDirty || assetBusy || (selectedTab === 'notes-files' && !selectedNotebookPath);
    if (
      [
        'new-note',
        'new-notebook',
        'new-from-template',
        'new-task',
        'show-tasks',
        'show-assets',
        'show-notebooks',
        'show-notes-files',
        'backup-library',
        'repair-broken-links',
      ].includes(id)
    )
      return !vault;
    if (id === 'new-library' || id === 'open-vault')
      return assetDirty || assetBusy || !!activeConflict || openNotes.some((note) => note.content !== note.saved);
    return false;
  };
  const downloadPercent = updater.status.state === 'download-progress' ? updater.status.percent : null;
  // Library views show the managed copy, not the original it came from,
  // unless the user turns "Show original files" on. Internal logic keeps
  // using the full vault; only these display lists are filtered.
  const displayEntries = filterHiddenOriginals(vault?.entries ?? [], settings.showOriginalFiles ?? false);
  const hiddenPaths = supersededPaths(vault?.entries ?? []);
  const displaySearchResults = settings.showOriginalFiles
    ? searchResults
    : searchResults.filter((result) => !hiddenPaths.has(result.path));
  const contextEntry = contextMenu?.path ? findEntry(vault?.entries ?? [], contextMenu.path) : undefined;
  const propertiesEntry = propertiesPath ? findEntryInTree(vault?.entries ?? [], propertiesPath) : undefined;
  const contextCommands = contextMenu
    ? getContextMenuCommands(contextMenu.context, Boolean(contextMenu.selection))
        .filter((command, index, commands) => commands.findIndex((item) => item.id === command.id) === index)
        .filter(
          (command) =>
            command.id !== 'import-file' ||
              !contextEntry ||
              isInternallySupportedPath(contextEntry.path),
        )
        .map((command) =>
          command.id === 'annotate-pdf-selection'
            ? { ...command, label: 'Add note' }
            : command.id === 'context-pin-tab' && contextMenu.tabId && pinnedTabs.has(contextMenu.tabId)
              ? { ...command, label: 'Unpin tab' }
              : command.id === 'context-protect' && contextEntry?.protected
                ? { ...command, label: 'Unprotect selected item' }
                : command,
        )
    : [];
  const disabledContextCommands = new Set<CommandId>();
  if (
    contextEntry &&
    (!isInternallySupportedPath(contextEntry.path) || !window.a11yNotebook?.vault.importEntry)
  )
    disabledContextCommands.add('import-file');
  if (!window.a11yNotebook?.vault.openWith) {
    disabledContextCommands.add('context-open-with');
    disabledContextCommands.add('context-open-with-default');
  }
  if (contextMenu && !contextMenu.selection)
    contextCommands
      .filter((command) => command.requiresSelection)
      .forEach((command) => disabledContextCommands.add(command.id));
  if (contextMenu?.context === 'tab' && tabs.length <= 1) disabledContextCommands.add('context-close-other-tabs');
  if (contextMenu?.context === 'tab' && !openNotes.some((item) => item.id === contextMenu.tabId))
    disabledContextCommands.add('context-reveal');
  if (contextMenu?.context === 'tree-note' && (!securityEnabled || encryptedNotePath === contextMenu.path))
    disabledContextCommands.add('context-encrypt-note');
  const contextMenuLabel = contextMenu?.path
    ? `Actions for ${contextMenu.path.split('/').at(-1)}`
    : contextMenu?.tabId
      ? `Actions for ${tabs.find((tab) => tab.id === contextMenu.tabId)?.label ?? contextMenu.tabId}`
      : contextMenu?.context === 'editor-selection'
        ? contextMenu.selection
          ? 'Actions for selected text'
          : 'Editor actions'
        : contextMenu?.context === 'reader-link'
          ? 'Link actions'
          : 'Application actions';
  const nativeMenuBlocked = Boolean(
    activeDialog ||
    itemDialog ||
    taskDialogOpen ||
    externalFile ||
    notePasswordDialog ||
    activeConflict ||
    exportRequest ||
    contextMenu,
  );
  const nativeMenuState: NativeMenuState = {
    enabled: Object.fromEntries(COMMANDS.map(({ id }) => [id, !nativeMenuBlocked && !isCommandDisabled(id)])),
    checked: {
      'toggle-right-pane': rightPaneOpen,
      'toggle-read-only-mode': mode === 'read-only',
      'toggle-focus-mode': focusMode,
      'toggle-bookmark': Boolean(currentNote && bookmarks.some((bookmark) => bookmark.path === currentNote.path)),
    },
  };
  const nativeMenuStateJson = JSON.stringify(nativeMenuState);
  useEffect(() => {
    const setMenuState = window.a11yNotebook?.setMenuState;
    if (setMenuState) setMenuState(JSON.parse(nativeMenuStateJson) as NativeMenuState);
  }, [nativeMenuStateJson]);
  // The titlebar names the current view and the current library, and
  // always ends with the app name, in the form "View | Library | A11y
  // Notebook", so keyboard view switches update it immediately and a
  // screen reader's title-bar shortcut always identifies the app. An open
  // note keeps its title only while it is the selected tab, in the same
  // "Note | Library | A11y Notebook" form. With no library open, the view
  // and the app name are all there is to show.
  const titleView =
    activeDialog === 'settings'
      ? 'Settings'
      : selectedTab === 'libraries'
        ? 'Libraries'
        : selectedTab === 'notebooks'
          ? 'Notebooks'
          : selectedTab === 'notes-files'
            ? 'Notes & Files'
            : selectedTab === 'tasks'
              ? 'Tasks'
              : selectedTab === 'assets'
                ? 'Cognitive Tools'
                : selectedTab === 'contents'
                  ? 'Contents'
                  : selectedTab === 'reminders'
                    ? 'Reminders'
                    : selectedTab === 'calendar'
                        ? 'Calendar'
                        : activeViewTitle;
  // While a dialog is open, the dialog's own Modal owns document.title
  // (it names the dialog, so JAWS Insert+T reads the dialog title).
  // This effect runs after the Modal's effect, so setting a title here
  // would overwrite the dialog title with the view behind it — the
  // Settings-title bug. Yield while any dialog is open; when it closes,
  // this effect reruns (activeDialog changed) and restores the view title.
  useEffect(() => {
    if (activeDialog) return;
    document.title =
      currentNote && vault && selectedTab === currentNote.id
        ? `${currentNote.title} | ${vault.name} | A11y Notebook`
        : vault
          ? `${titleView} | ${vault.name} | A11y Notebook`
          : `${titleView} | A11y Notebook`;
  }, [titleView, currentNote, vault, selectedTab, activeDialog]);

  const showCommandButtons = !window.a11yNotebook || settings.showCommandButtons === true;

  // The notebook a Quick Task goes to without asking: the notebook whose
  // Notes & Files grid is visibly open. On the landing grid (or any other
  // tab) the remembered notebook path does not count as open, so the task
  // dialog carries the notebook chooser instead.
  const quickTaskNotebookOpen =
    selectedTab === 'notes-files' && selectedNotebookPath ? selectedNotebookPath : undefined;

  return (
    <div
      className={`${showCommandButtons ? 'app-shell' : 'app-shell command-buttons-hidden'}${focusMode ? ' focus-mode' : ''}${focusMode && settings.immersiveFocusMode ? ' immersive-focus-mode' : ''}`}
      aria-label="A11y Notebook application shell"
    >
      {contextMenu ? (
        <GlobalContextMenu
          commands={contextCommands}
          label={contextMenuLabel}
          x={contextMenu.x}
          y={contextMenu.y}
          invoker={contextMenu.invoker}
          disabled={disabledContextCommands}
          onClose={() => setContextMenu(null)}
          onSelect={(command) => void handleContextCommand(command)}
        />
      ) : null}
      {taskDialogOpen ? (
        <AssociatedTaskDialog
          paths={taskNotePaths}
          initialPath={currentNote?.path}
          busy={taskCreating}
          error={taskCreateError}
          priorityOptions={priorityOptions}
          onCreate={createTask}
          onClose={() => setTaskDialogOpen(false)}
        />
      ) : null}
      {taskScheduleDialog ? (
        <TaskScheduleDialog
          task={taskScheduleDialog}
          onSave={(schedule) => saveTaskSchedule(taskScheduleDialog, schedule)}
          onClose={() => setTaskScheduleDialog(null)}
        />
      ) : null}
      {citationDialog && citationNotebookPath ? (
        <CitationDialog
          notebookPath={citationNotebookPath}
          initialView={citationDialog}
          onInsertInText={insertCitationText}
          onInsertBibliography={insertBibliography}
          onInsertFootnote={insertFootnote}
          canInsert={mode === 'edit' && !currentNoteEditLocked}
          onSwitchToEdit={
            mode !== 'edit' && !currentNoteEditLocked
              ? () => handleCommand('toggle-read-only-mode')
              : undefined
          }
          onClose={() => setCitationDialog(null)}
        />
      ) : null}
      {taskPriorityDialog ? (
        <TaskPriorityDialog
          task={taskPriorityDialog}
          options={priorityOptions}
          onSave={(priority) => saveTaskPriority(taskPriorityDialog, priority)}
          onOptionsChange={savePriorityOptions}
          onClose={() => setTaskPriorityDialog(null)}
        />
      ) : null}
      {taskLinkDialog ? (
        <TaskLinkDialog
          task={taskLinkDialog.task}
          kind={taskLinkDialog.kind}
          targets={
            taskLinkDialog.kind === 'notebook' ? notebooks : taskLinkDialog.kind === 'note' ? notePaths : filePaths
          }
          onSave={(target) => saveTaskLink(taskLinkDialog.task, taskLinkDialog.kind, target)}
          onClose={() => setTaskLinkDialog(null)}
        />
      ) : null}
      {pasteLibraryPrompt ? (
        <PasteLibraryDialog
          folderName={pasteLibraryPrompt.name}
          onChoice={(choice) => {
            setPasteLibraryPrompt(null);
            pasteLibraryResolver.current?.(choice);
            pasteLibraryResolver.current = null;
          }}
        />
      ) : null}
      {pasteOrphanPrompt ? (
        <PasteOrphanDialog
          files={pasteOrphanPrompt.files}
          onChoice={(result) => {
            setPasteOrphanPrompt(null);
            pasteOrphanResolver.current?.(result);
            pasteOrphanResolver.current = null;
          }}
        />
      ) : null}
      <header className="app-header" aria-label="Application header">
        <div className="global-search">
          <label htmlFor="global-search" className="sr-only">
            Global search
          </label>
          <input
            id="global-search"
            ref={searchRef}
            type="search"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder="Search library, notes, tasks, files"
          />
        </div>
        <fieldset className="global-search-scope">
          <legend>Search scope</legend>
          <label>
            <input
              type="radio"
              name="search-scope"
              value="current"
              checked={searchScope === 'current'}
              onChange={() => setSearchScope('current')}
              disabled={!vault}
            />
            {selectedNotebookName ? `Current notebook: ${selectedNotebookName}` : 'Current notebook (none selected)'}
          </label>
          <label>
            <input
              type="radio"
              name="search-scope"
              value="library"
              checked={searchScope === 'library'}
              onChange={() => setSearchScope('library')}
              disabled={!vault}
            />
            Whole library
          </label>
        </fieldset>
        <div className="title-block">
          <span className="current-item">
            {currentNote?.title ?? 'No note open'} / {vault?.name ?? 'No library open'}
          </span>
        </div>
      </header>

      {/* Focus Mode announcements live here, not in the status bar: the
          status bar is hidden in Focus Mode, and a display:none live region
          would never be announced. The region stays mounted even when
          empty: a freshly mounted region carrying text is announced only
          sometimes, while a text change on a persistent region announces
          every time. */}
      <p className="sr-only" role="status">
        {focusAnnouncement}
      </p>

      {showCommandButtons && (
        <nav className="menu-bar" aria-label="Main menu">
          {menuGroups.map((group) => {
            const labelId = `menu-group-${group.label.toLowerCase()}`;
            return (
              <div key={group.label} className="menu-group" role="group" aria-labelledby={labelId}>
                <span id={labelId} className="menu-label">
                  {group.label}
                </span>
                {group.items.map((commandId) => {
                  const command = getCommandById(commandId);
                  if (!command) return null;
                  return (
                    <button
                      key={command.id}
                      type="button"
                      className="menu-item"
                      disabled={isCommandDisabled(command.id)}
                      onClick={() => handleCommand(command.id)}
                      aria-keyshortcuts={
                        [settings.shortcuts[command.id] ?? defaultShortcut(command, isMac), ...(command.shortcutAliases ?? [])]
                          .filter((shortcut): shortcut is string => Boolean(shortcut))
                          .map((shortcut) => (isMac ? toMacAriaKeyShortcut(shortcut) : toAriaKeyShortcut(shortcut)))
                          .join(' ') || undefined
                      }
                    >
                      {isMac ? command.label.replace('Explorer', 'Finder') : command.label}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </nav>
      )}

      <div className="workspace">
        <aside
          ref={navigationRef}
          className={activeRegion === 'navigation' ? 'panel active-panel' : 'panel'}
          data-region="navigation"
          aria-label="Navigation pane"
          tabIndex={-1}
        >
          <h2>{vault?.name ?? 'Library'}</h2>
          {showCommandButtons && (
            <div className="vault-actions">
              <button type="button" onClick={() => handleCommand('show-tasks')} disabled={!vault}>
                Open Tasks
              </button>
              <button type="button" onClick={() => void createNote()} disabled={!vault}>
                New note
              </button>
              <button
                type="button"
                onClick={() => handleCommand('add-link')}
                disabled={isCommandDisabled('add-link')}
              >
                Add link
              </button>
              <button type="button" onClick={() => handleCommand('new-notebook')} disabled={!vault}>
                New notebook
              </button>
              <button
                type="button"
                onClick={() => handleCommand('import-file')}
                disabled={isCommandDisabled('import-file')}
              >
                Import file
              </button>
              <button
                type="button"
                onClick={() => treeSelection && void window.a11yNotebook?.vault.reveal(treeSelection)}
                disabled={!treeSelection}
              >
                Reveal in Explorer
              </button>
              <button
                type="button"
                onClick={() => handleCommand('open-selected-external')}
                disabled={isCommandDisabled('open-selected-external')}
              >
                Open in external app
              </button>
            </div>
          )}
          {!vault ? (
            <p>Open a folder as a local library from the File menu.</p>
          ) : null}
          {/* The notes grid stays available while a note or file is open:
          it is the way to open several notes at once without leaving the
          document to go back to the Notes and Files screen. It renders
          only on document tabs, when the main grid is unmounted, so the
          two never duplicate. Focus Mode hides the whole navigation
          pane, which is the one case where the grid hides with a
          document open. */}
          {vault && !securityLocked &&
          (selectedTab === 'attachment' ||
            selectedTab === 'assets' ||
            openNotes.some((note) => note.id === selectedTab)) ? (
            <NotesFilesScreen
              showCommandButtons={showCommandButtons}
              title={viewTitles['notes-files']}
              entries={displayEntries}
              hasLibrary={!!vault}
              onNewNote={() => handleCommand('new-note')}
              onNewFromTemplate={() => handleCommand('new-from-template')}
              notebookPath={selectedNotebookPath}
              creationDisabled={securityLocked || switchingVault || !!relocatingPath}
              selectedPath={treeSelection}
              onSelect={selectEntry}
              onOpen={openDetailsEntry}
              onRename={(entry) => renameEntry(entry.path)}
              onDelete={(entry) => void deleteEntry(entry.path)}
              onDeletePermanent={(entry) => void deleteEntryPermanently(entry.path)}
              onContextMenu={(_, invoker, pointer) => openContextMenu(invoker, pointer)}
            />
          ) : null}
          {vault ? (
            <SearchResults
              filters={searchFilters}
              onFilters={setSearchFilters}
              notebooks={notebooks}
              results={displaySearchResults}
              active={Boolean(searchText.trim() || Object.values(searchFilters).some(Boolean))}
              scope={searchScope}
              selectedNotebookPath={selectedNotebookPath}
              selectedNotebookName={selectedNotebookName}
              scopeBlocked={searchScope === 'current' && !selectedNotebookPath}
              onOpen={(result) => {
                if (result.kind === 'task' && result.targetId) {
                  // The task filters could hide the row (a done task under
                  // the Open filter, for example): show everything first,
                  // then focus the row once the Tasks view renders.
                  setTaskStatusFilter('all');
                  setTaskDueFilter('any');
                  setTaskPriorityFilter('all');
                  setTaskNotebookFilter('all');
                  setTaskTabOpen(true);
                  navigateScreen('tasks');
                  setPendingSearchFocus({ tab: 'tasks', id: result.targetId, announce: `Task: ${result.title}.` });
                  return;
                }
                if (result.kind === 'reminder' && result.targetId) {
                  const reminder = reminderState.reminders.find((item) => item.id === result.targetId);
                  setReminderTabOpen(true);
                  navigateScreen('reminders');
                  setPendingSearchFocus({
                    tab: 'reminders',
                    id: result.targetId,
                    announce: reminder
                      ? `Reminder: ${reminder.title}, ${new Date(reminder.scheduledAt).toLocaleString()}.`
                      : `Reminder: ${result.title}.`,
                  });
                  return;
                }
                if (result.kind === 'appointment' && result.targetId) {
                  navigateScreen('calendar');
                  setOpenAppointmentRequest({ id: result.targetId, nonce: Date.now() });
                  return;
                }
                const entry = findEntry(vault.entries, result.path);
                if (entry) void openEntry(entry).catch(() => setStatusMessage('Could not open the search result.'));
              }}
            />
          ) : null}
          {tags.length ? (
            <section aria-label="Tags">
              <h3>Tags</h3>
              <ul>
                {tags.map((tag) => (
                  <li key={tag}>
                    <button type="button" onClick={() => setSearchFilters((filters) => ({ ...filters, tag }))}>
                      #{tag}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </aside>

        <div className="content-panel">
          <div
            ref={tabListRef}
            className={activeRegion === 'tabs' ? 'tab-bar active-panel' : 'tab-bar'}
            data-region="tabs"
            role="tablist"
            aria-label="Open tabs"
          >
            {tabs.map((tab, index) => {
              const selected = selectedTab === tab.id;
              return (
                <div key={tab.id} className="tab-control">
                  <button
                    ref={(element) => {
                      tabRefs.current[tab.id] = element;
                    }}
                    id={tabDomId(tab.id)}
                    data-context="tab"
                    data-tab-id={tab.id}
                    type="button"
                    className={selected ? 'tab active-tab' : 'tab'}
                    role="tab"
                    aria-selected={selected}
                    aria-controls={TAB_PANEL_ID}
                    aria-label={`${tab.label}${pinnedTabs.has(tab.id) ? ', pinned' : ''}`}
                    tabIndex={selected ? 0 : -1}
                    onClick={() => setSelectedTab(tab.id)}
                    onKeyDown={(event) => handleTabKeyDown(event, index)}
                  >
                    {tab.label}
                  </button>
                  {!NAVIGATION_SCREENS.some((screen) => screen.id === tab.id) ? (
                    <button
                      type="button"
                      className="close-tab"
                      aria-label={`Close ${tab.label}`}
                      onClick={() => closeContextTab(tab.id)}
                    >
                      ×
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>

          <main aria-label="Main content">
            <article
              ref={tabPanelRef}
              id={TAB_PANEL_ID}
              className={activeRegion === 'main' ? 'document active-panel' : 'document'}
              data-region="main"
              role="tabpanel"
              aria-label={activeViewTitle}
              aria-labelledby={viewTitles[selectedTab] ? undefined : tabDomId(selectedTab)}
              tabIndex={0}
              onPaste={(event) => void handlePanelPaste(event)}
            >
            {assetTabOpen ? (
              <div hidden={selectedTab !== 'assets'}>
                {vault ? (
                  <AssetsWorkspace
                    title={viewTitles.assets}
                    paths={allEntries
                      .filter((entry) => entry.kind !== 'notebook' && isManagedEntry(entry))
                      .map((entry) => entry.path)}
                    initialPath={assetInitialPath}
                    selectionVersion={assetSelectionVersion}
                    creationRequestVersion={assetCreationVersion}
                    refresh={refreshVault}
                    announce={setStatusMessage}
                    onDirty={setAssetDirty}
                    onBusy={setAssetBusy}
                  />
                ) : (
                  <section>
                    <h2>{viewTitles.assets}</h2>
                    <p>Open a library before creating cognitive tools.</p>
                  </section>
                )}
              </div>
            ) : null}
            {securityLocked || selectedTab === 'assets' ? null : selectedTab === 'contents' ? (
              <ContentsScreen vault={vault} entries={displayEntries} onNavigate={navigateScreen} />
            ) : selectedTab === 'libraries' ? (
              <LibrariesScreen
                showCommandButtons={showCommandButtons}
                vault={vault}
                recentLibraries={recentLibraries}
                onOpenLibrary={() => handleCommand('open-vault')}
                onNewLibrary={() => handleCommand('new-library')}
                onOpenRecent={(libraryPath) => openLibrary(false, libraryPath)}
                onDeleteLibrary={(library) => setDeleteLibraryTarget({ ...library, permanent: false })}
                onDeletePermanent={(library) => setDeleteLibraryTarget({ ...library, permanent: true })}
                onLibraryContextMenu={(library, invoker, pointer) => {
                  const bounds = invoker.getBoundingClientRect();
                  setContextMenu({
                    context: 'library',
                    invoker,
                    path: library.path,
                    x: pointer?.x ?? bounds.left,
                    y: pointer?.y ?? bounds.bottom,
                  });
                }}
                disabled={switchingVault || securityLocked}
              />
            ) : selectedTab === 'notebooks' ? (
              <NotebooksScreen
                showCommandButtons={showCommandButtons}
                title={viewTitles.notebooks}
                entries={displayEntries}
                hasLibrary={!!vault}
                onNewNotebook={() => handleCommand('new-notebook')}
                selectedPath={treeSelection}
                onSelect={selectEntry}
                onOpen={openDetailsEntry}
                onRename={(entry) => renameEntry(entry.path)}
                onDelete={(entry) => void deleteEntry(entry.path)}
                onDeletePermanent={(entry) => void deleteEntryPermanently(entry.path)}
                onContextMenu={(_, invoker, pointer) => openContextMenu(invoker, pointer)}
              />
            ) : selectedTab === 'notes-files' ? (
              <NotesFilesScreen
                showCommandButtons={showCommandButtons}
                title={viewTitles['notes-files']}
                entries={displayEntries}
                hasLibrary={!!vault}
                onNewNote={() => handleCommand('new-note')}
                onNewFromTemplate={() => handleCommand('new-from-template')}
                notebookPath={selectedNotebookPath}
                creationDisabled={securityLocked || switchingVault || !!relocatingPath}
                selectedPath={treeSelection}
                onSelect={selectEntry}
                onOpen={openDetailsEntry}
                onRename={(entry) => renameEntry(entry.path)}
                onDelete={(entry) => void deleteEntry(entry.path)}
                onDeletePermanent={(entry) => void deleteEntryPermanently(entry.path)}
                onContextMenu={(_, invoker, pointer) => openContextMenu(invoker, pointer)}
              />
            ) : selectedTab === 'calendar' ? (
              vault && !switchingVault ? (
                <CalendarScreen
                  title={viewTitles.calendar}
                  key={`${vault.path}:${vaultGenerationRef.current}`}
                  vaultPath={vault.path}
                  // Appointment links only open the note, like reminders:
                  // they never write into it, so notes without a managed
                  // provenance record are linkable here too.
                  notePaths={reminderNotePaths}
                  filePaths={filePaths}
                  isCurrent={() =>
                    !switchingRef.current &&
                    vaultPathRef.current === vault.path &&
                    vaultGenerationRef.current === calendarGeneration
                  }
                  announce={setStatusMessage}
                  createRequest={calendarCreateRequest}
                  openRequest={openAppointmentRequest}
                  onOpenEntry={async (relative) => {
                    const entry = findEntry(vault.entries, relative);
                    if (!entry) throw new Error('The linked item is no longer available.');
                    await openEntry(entry);
                  }}
                />
              ) : (
                <p>Open and unlock a library to view the calendar.</p>
              )
            ) : selectedTab === 'reminders' ? (
              <RemindersView
                title={viewTitles.reminders}
                reminders={reminderState.reminders}
                notePaths={reminderNotePaths}
                filePaths={filePaths}
                createRequest={reminderCreateRequest}
                initialPath={reminderCreatePath}
                defaults={reminderState.defaults}
                onSaveDefaults={reminderState.saveDefaults}
                onCreate={async (input) => {
                  reminderState.setReminders(await window.a11yNotebook!.vault.createReminder(input));
                  setStatusMessage('Reminder created.');
                }}
                onDismiss={async (id) => {
                  reminderState.setReminders(await window.a11yNotebook!.vault.dismissReminder(id));
                  setStatusMessage('Reminder dismissed.');
                }}
                onSnooze={async (id, duration) => {
                  reminderState.setReminders(await window.a11yNotebook!.vault.snoozeReminder(id, duration));
                  setStatusMessage('Reminder snoozed.');
                }}
                onOpenNote={async (relative) => {
                  const entry = findEntry(vault?.entries ?? [], relative);
                  if (entry) await openEntry(entry);
                }}
                onOpenCalendar={() => setSelectedTab('calendar')}
              />
            ) : selectedTab === 'attachment' && attachment ? (
              <div ref={attachmentRef}>
                <AttachmentView
                  key={attachment.path}
                  preview={attachment}
                  alt={imageAlt}
                  announce={setStatusMessage}
                  onExternal={() =>
                    void window.a11yNotebook?.vault
                      .openExternal(attachment.path)
                      .catch(() => setStatusMessage('Could not open attachment externally.'))
                  }
                  onSaveAlt={async (alt) => {
                    await window.a11yNotebook!.vault.saveImageAlt(attachment.path, alt);
                    setImageAlt(alt);
                  }}
                  onTranscribe={
                    isAudioPath(attachment.path)
                      ? () => void transcribeAudio(attachment.path)
                      : undefined
                  }
                  transcribing={transcribingAudio}
                  transcriptPath={
                    isAudioPath(attachment.path) ? transcriptForAudio(attachment.path) : null
                  }
                  onOpenTranscript={() => {
                    const transcriptPath = transcriptForAudio(attachment.path);
                    if (!transcriptPath) return;
                    const entry = findEntry(vault?.entries ?? [], transcriptPath);
                    if (entry) void openEntry(entry);
                  }}
                  spreadsheetSaveRef={spreadsheetSaveRef}
                  onSpreadsheetFileCreated={() => {
                    void refreshVault();
                  }}
                />
              </div>
            ) : selectedTab === 'tasks' ? (
              <section aria-labelledby="tasks-heading">
                <h2 id="tasks-heading">{viewTitles.tasks}</h2>
                {showCommandButtons && (
                  <button type="button" disabled={!vault} onClick={() => handleCommand('new-task')}>
                    New task
                  </button>
                )}
                <TaskProgressSummaries tasks={tasks} />
                <p role="status" aria-live="polite">
                  {visibleTasks.length} tasks shown.
                </p>
                <div className="task-filters">
                  <label>
                    Task status
                    <select
                      value={taskStatusFilter}
                      onChange={(event) => {
                        setTaskStatusFilter(event.target.value as typeof taskStatusFilter);
                      }}
                    >
                      <option value="open">Open</option>
                      <option value="done">Done</option>
                      <option value="all">All</option>
                    </select>
                  </label>
                  <label>
                    Due date
                    <select
                      value={taskDueFilter}
                      onChange={(event) => {
                        setTaskDueFilter(event.target.value as typeof taskDueFilter);
                      }}
                    >
                      <option value="any">Any date</option>
                      <option value="today">Due today</option>
                      <option value="overdue">Overdue</option>
                      <option value="upcoming">Upcoming</option>
                    </select>
                  </label>
                  <label>
                    Task priority
                    <select
                      value={taskPriorityFilter}
                      onChange={(event) => setTaskPriorityFilter(event.target.value)}
                    >
                      <option value="all">All priorities</option>
                      {priorityOptions.map((option) => (
                        <option key={option} value={option}>
                          {formatPriorityName(option)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Notebook
                    <select value={taskNotebookFilter} onChange={(event) => setTaskNotebookFilter(event.target.value)}>
                      <option value="all">All notebooks</option>
                      {taskNotebooks.map((notebook) => (
                        <option key={notebook} value={notebook}>
                          {notebook}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="table-scroll">
                  <table>
                    <caption>{vault ? `Tasks in ${vault.name}` : 'Tasks in the open library'}</caption>
                    <thead>
                      <tr>
                        <th scope="col">Task</th>
                        <th scope="col">Notebook</th>
                        <th
                          scope="col"
                          aria-sort={taskSort === 'due' ? (dueAscending ? 'ascending' : 'descending') : 'none'}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              setTaskSort('due');
                              setDueAscending((ascending) => !ascending);
                            }}
                          >
                            Due date
                          </button>
                        </th>
                        <th
                          scope="col"
                          aria-sort={
                            taskSort === 'priority' ? (priorityAscending ? 'ascending' : 'descending') : 'none'
                          }
                        >
                          <button
                            type="button"
                            onClick={() => {
                              setTaskSort('priority');
                              setPriorityAscending((ascending) => !ascending);
                            }}
                          >
                            Priority
                          </button>
                        </th>
                        <th scope="col">Links</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleTasks.map((task) => (
                        <tr
                          key={task.id}
                          data-context="task-row"
                          data-path={task.path}
                          data-task-id={task.taskId ?? task.id}
                          data-task-line={task.line}
                          tabIndex={-1}
                        >
                          <th scope="row">
                            <label>
                              <input type="checkbox" checked={task.complete} onChange={() => void toggleTask(task)} />
                              {task.text}
                            </label>
                          </th>
                          <td>{notebookForTask(task)}</td>
                          <td>{formatTaskDueDate(task.dueDate, task.dueTime)}</td>
                          <td>{formatPriorityName(task.priority ?? 'medium')}</td>
                          <td>
                            {taskLinks
                              .filter((link) => link.taskId === task.id)
                              .map((link) => (
                                <span key={link.id}>
                                  <button type="button" onClick={() => void openTaskLink(link)}>
                                    Open {link.kind}: {link.target}
                                  </button>{' '}
                                  <button type="button" onClick={() => void removeTaskLink(link)}>
                                    Remove link to {link.target}
                                  </button>{' '}
                                </span>
                              ))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!visibleTasks.length ? <p>No tasks match these filters.</p> : null}
                </div>
              </section>
            ) : currentNote ? (
              <>
                <h2>{currentNote.title}</h2>
                {showCommandButtons && mode === 'read-only' ? (
                  <button type="button" onClick={() => void toggleActiveBookmark()}>
                    {bookmarks.some((bookmark) => bookmark.path === currentNote.path)
                      ? 'Remove bookmark'
                      : 'Bookmark note'}
                  </button>
                ) : null}
                {mode === 'read-only' && securityEnabled ? (
                  encryptedNotePath === currentNote.path ? (
                    <span role="status">Encrypted note</span>
                  ) : (
                    <button
                      type="button"
                      disabled={currentNote.content !== currentNote.saved}
                      onClick={() => {
                        setNotePasswordDialog({
                          action: 'encrypt',
                          entry: {
                            name: currentNote.title,
                            path: currentNote.path,
                            kind: 'note',
                            provenance: 'created',
                          },
                        });
                      }}
                    >
                      Encrypt note
                    </button>
                  )
                ) : null}
                {showCommandButtons && !focusMode && (
                  <button type="button" onClick={() => void beginExport(currentNote.path)}>
                    Export note…
                  </button>
                )}
                {mode === 'edit' ? (
                  <>
                    {showCommandButtons && !focusMode && (
                      <button type="button" onClick={() => void saveActiveNote()}>
                        Save note
                      </button>
                    )}
                    {!focusMode && (
                      <button
                        type="button"
                        disabled={currentNote.path === encryptedNotePath}
                        onClick={() => void convertActiveNoteFormat()}
                      >
                        Convert to {/\.(?:html)$/i.test(currentNote.path) ? 'Markdown' : 'HTML'} copy…
                      </button>
                    )}
                  </>
                ) : null}
                {currentNoteEditLocked && currentNote.content !== currentNote.saved && !focusMode ? (
                  <button type="button" onClick={() => void saveActiveNote()}>
                    Save locked note changes
                  </button>
                ) : null}
                {mode === 'edit' ? (
                  <>
                    <EditorTools
                      showCommandButtons={showCommandButtons && !focusMode}
                      ref={editorToolsRef}
                      textareaRef={editorRef}
                      bindShortcuts={false}
                      // Wiki links only point at a note; they never write
                      // into it, so every note is linkable, including
                      // legacy notes without an origin record that task
                      // linking must exclude.
                      notePaths={reminderNotePaths}
                      announce={setStatusMessage}
                      onRequestAttachment={() => handleCommand('insert-attachment')}
                      onContentChange={(content) => updateNoteContent(currentNote.id, content)}
                    />
                    {showCommandButtons && !focusMode ? (
                      <>
                        <button type="button" onClick={() => void addAnchoredBookmark('heading')}>
                          Bookmark heading at cursor
                        </button>
                        <button type="button" onClick={() => void addAnchoredBookmark('position')}>
                          Bookmark position at cursor
                        </button>
                        <button type="button" aria-pressed={dictationActive} onClick={() => toggleDictation()}>
                          {dictationActive ? 'Stop dictation' : 'Dictate'}
                        </button>
                      </>
                    ) : null}
                  </>
                ) : !focusMode ? (
                  annotationTools.toolbar
                ) : null}
                <div ref={annotationTools.documentRef}>
                  <MarkdownDocument
                    disabled={switchingVault}
                    notePath={currentNote.path}
                    editorRef={editorRef}
                    content={currentNote.content}
                    format={
                      /\.html?$/i.test(currentNote.path)
                        ? 'html'
                        : /\.txt$/i.test(currentNote.path)
                          ? 'text'
                          : 'markdown'
                    }
                    mode={mode}
                    links={links.filter((link) => link.sourcePath === currentNote.path)}
                    onChange={(content) => updateNoteContent(currentNote.id, content)}
                    announce={setStatusMessage}
                    hideModeToggle={focusMode}
                    onNavigate={(href) => void openLinkTarget(href)}
                    onOpenExternal={(url) => void window.a11yNotebook?.vault.openUrl(url)}
                    htmlTasks={tasks.filter((task) => task.path === currentNote.path && task.htmlTask)}
                    onToggleHtmlTask={(taskId) => {
                      const task = tasks.find(
                        (item) => item.path === currentNote.path && item.htmlTask && item.taskId === taskId,
                      );
                      if (task) void toggleTask(task);
                    }}
                    onToggleMarkdownTask={
                      mode === 'read-only' && !currentNoteProtected && !currentNoteEditLocked && !switchingVault
                        ? (line) => {
                            const task = tasks.find(
                              (item) => item.path === currentNote.path && !item.htmlTask && item.line === line,
                            );
                            if (task) void toggleTask(task);
                          }
                        : undefined
                    }
                  />
                </div>
              </>
            ) : (
              <LibrariesScreen
                showCommandButtons={showCommandButtons}
                vault={vault}
                recentLibraries={recentLibraries}
                onOpenLibrary={() => handleCommand('open-vault')}
                onNewLibrary={() => handleCommand('new-library')}
                onOpenRecent={(libraryPath) => openLibrary(false, libraryPath)}
                onDeleteLibrary={(library) => setDeleteLibraryTarget({ ...library, permanent: false })}
                onDeletePermanent={(library) => setDeleteLibraryTarget({ ...library, permanent: true })}
                onLibraryContextMenu={(library, invoker, pointer) => {
                  const bounds = invoker.getBoundingClientRect();
                  setContextMenu({
                    context: 'library',
                    invoker,
                    path: library.path,
                    x: pointer?.x ?? bounds.left,
                    y: pointer?.y ?? bounds.bottom,
                  });
                }}
                disabled={switchingVault || securityLocked}
              />
            )}
          </article>
        </main>
        </div>

        {rightPaneOpen ? (
          <aside
            ref={rightPaneRef}
            className={activeRegion === 'right-pane' ? 'side-panel active-panel' : 'side-panel'}
            data-region="right-pane"
            aria-label="Right information pane"
            tabIndex={-1}
          >
            <h2>Info</h2>
            <dl>
              <dt>Mode</dt>
              <dd>{mode}</dd>
              <dt>Last action</dt>
              <dd>{statusMessage}</dd>
              <dt>Search</dt>
              <dd>{searchText || 'No active query'}</dd>
            </dl>
            {currentNote ? (
              <>
                {annotationTools.pane}
                <section aria-labelledby="outgoing-links-heading">
                  <h3 id="outgoing-links-heading">Outgoing links</h3>
                  <ul>
                    {links
                      .filter((link) => link.sourcePath === currentNote.path)
                      .map((link, index) => (
                        <li key={`${link.sourcePath}-${index}`}>
                          {link.resolved && link.targetPath ? (
                            <button type="button" onClick={() => void openLinkTarget(link.targetPath!)}>
                              {link.targetTitle}
                            </button>
                          ) : (
                            <>
                              <span>{link.targetTitle}, missing note</span>{' '}
                              <button
                                type="button"
                                onClick={() => {
                                  setBrokenLinkFilter(link.sourcePath);
                                  setActiveDialog('broken-links');
                                }}
                              >
                                Repair
                              </button>
                            </>
                          )}
                        </li>
                      ))}
                  </ul>
                </section>
                <section aria-labelledby="backlinks-heading">
                  <h3 id="backlinks-heading">Backlinks</h3>
                  <ul>
                    {links
                      .filter((link) => link.targetPath === currentNote.path)
                      .map((link) => (
                        <li key={`${link.sourcePath}-${link.targetPath}`}>
                          <button
                            type="button"
                            onClick={() => {
                              const entry = findEntry(vault?.entries ?? [], link.sourcePath);
                              if (entry) void openEntry(entry);
                            }}
                          >
                            {link.sourcePath}
                          </button>
                        </li>
                      ))}
                  </ul>
                </section>
              </>
            ) : null}
            <section aria-labelledby="bookmarks-heading">
              <h3 id="bookmarks-heading">Bookmarks</h3>
              <ul>
                {bookmarks.map((bookmark) => {
                  // A user-chosen name wins; otherwise the title as the
                  // reader sees it (a heading stored from source may
                  // carry Markdown formatting).
                  const label = bookmark.name ?? normalizeHeadingText(bookmark.title);
                  return (
                    <li key={bookmark.id}>
                      <button
                        type="button"
                        onClick={() => {
                          const entry = findEntry(vault?.entries ?? [], bookmark.path);
                          if (entry) {
                            if (bookmark.anchor)
                              setPendingBookmarkAnchor({
                                path: bookmark.path,
                                anchor: bookmark.anchor,
                                nonce: Date.now(),
                              });
                            void openEntry(entry);
                          }
                        }}
                      >
                        {bookmark.anchor?.kind === 'heading'
                          ? `${label} — ${bookmark.path.split('/').pop()}`
                          : bookmark.anchor?.kind === 'offset'
                            ? `${label} (position)`
                            : label}
                      </button>{' '}
                      <button type="button" onClick={() => void removeBookmarkById(bookmark.id)}>
                        Remove
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          </aside>
        ) : null}
      </div>

      <footer ref={statusRef} className="status-bar" data-region="status" aria-label="Status bar" tabIndex={-1}>
        <span className="status-message" role="status" aria-live="polite">
          {statusMessage}
        </span>
        {downloadPercent !== null ? <span>Update download: {downloadPercent}%</span> : null}
        <span>Pane: {REGION_LABELS[activeRegion]}</span>
        <span>Mode: {mode}</span>
      </footer>

      {activeDialog === 'palette' ? (
        <CommandPalette
          shortcuts={settings.shortcuts}
          isMac={isMac}
          isDisabled={isCommandDisabled}
          onRun={handleCommand}
          onClose={closeDialog}
        />
      ) : null}
      {activeDialog === 'shortcuts' ? (
        <KeyboardShortcutsDialog
          shortcuts={settings.shortcuts}
          aliasShortcuts={settings.shortcutAliases}
          isMac={isMac}
          onClose={closeDialog}
        />
      ) : null}
      {activeDialog === 'about' ? <AboutDialog onClose={closeDialog} /> : null}
      {activeDialog === 'feedback' ? (
        <FeedbackDialog onClose={closeDialog} announce={setStatusMessage} />
      ) : null}
      {tutorialOpen ? <TutorialDialog onClose={() => setTutorialOpen(false)} /> : null}
      {vault && !securityLocked && settingsVaultPath === vault.path ? (
        <ReminderAlerts
          key={vault.path}
          vaultPath={vault.path}
          settings={settings}
          blocked={
            !!activeDialog ||
            !!itemDialog ||
            !!notePasswordDialog ||
            !!externalFile ||
            taskDialogOpen ||
            !!activeConflict ||
            switchingRef.current
          }
          onComplete={completeReminder}
          announce={setStatusMessage}
        />
      ) : null}
      {vault && securityLocked && settingsVaultPath === vault.path ? (
        <LockedReminderAlerts
          key={`locked:${vault.path}`}
          vaultPath={vault.path}
          settings={settings}
          announce={setStatusMessage}
        />
      ) : null}
      {activeDialog === 'settings' ? (
        <SettingsDialog
          settings={settings}
          isMac={isMac}
          onShortcutCaptureChange={(active) => window.a11yNotebook?.setShortcutCaptureActive?.(active)}
          securityEnabled={securityEnabled}
          recoveryAvailable={recoveryAvailable}
          onClose={closeDialog}
          onSave={async (value) => {
            if (await persistSettings(value)) {
              setStatusMessage('Settings saved.');
            }
          }}
          onSetVaultPassword={async (password) => {
            const setupPassword = window.a11yNotebook?.vault.setupVaultPassword;
            if (!setupPassword) throw new Error('Library security is unavailable.');
            await setupPassword(password);
            setSecurityEnabled(true);
            setSecurityLocked(false);
            setRecoveryAvailable(false);
            setStatusMessage('Library password protection enabled.');
          }}
          onPrepareRecovery={async (password) => {
            const prepare = window.a11yNotebook?.vault.prepareVaultRecovery;
            if (!prepare) throw new Error('Library recovery is unavailable.');
            return prepare(password);
          }}
          onAcknowledgeRecovery={async (acknowledged) => {
            const acknowledge = window.a11yNotebook?.vault.acknowledgeVaultRecovery;
            if (!acknowledge) throw new Error('Library recovery is unavailable.');
            await acknowledge(acknowledged);
            if (acknowledged) {
              setRecoveryAvailable(true);
              setStatusMessage('Library recovery enabled.');
            }
          }}
          onRevokeRecovery={async (password) => {
            const revoke = window.a11yNotebook?.vault.revokeVaultRecovery;
            if (!revoke) throw new Error('Library recovery is unavailable.');
            await revoke(password);
            setRecoveryAvailable(false);
            setStatusMessage('Library recovery revoked.');
          }}
          onRotateDataKey={async (password, recoveryKey) => {
            const rotate = window.a11yNotebook?.vault.rotateVaultDataKey;
            if (!rotate) throw new Error('Data key rotation is unavailable.');
            await rotate(password, recoveryKey);
            setStatusMessage('Data key rotated.');
          }}
          onLockVault={async () => {
            await window.a11yNotebook?.vault.lockVault?.();
            setSecurityLocked(true);
            setOpenNotes([]);
            setNotePasswordDialog(null);
            setAttachment(null);
            setMode('read-only');
          }}
          onSaveCredential={async (id, username, password) => {
            const save = window.a11yNotebook?.vault.saveCredential;
            if (!save) throw new Error('Credential storage is unavailable.');
            await save(id, username, password);
          }}
          onDeleteCredential={async (id) => {
            const remove = window.a11yNotebook?.vault.deleteCredential;
            if (!remove) throw new Error('Credential storage is unavailable.');
            await remove(id);
          }}
        />
      ) : null}
      {spellingOpen && currentNote ? (
        <SpellingDialog
          notePath={currentNote.path}
          content={currentNote.content}
          customWords={settings.customDictionary ?? []}
          onApply={(nextContent) => {
            updateNoteContent(currentNote.id, nextContent);
            setStatusMessage('Spelling and grammar check applied.');
          }}
          onAddToDictionary={(word) => void addToCustomDictionary(word)}
          onClose={() => setSpellingOpen(false)}
        />
      ) : null}
      {findOpen ? (
        <FindDialog
          onClose={() => setFindOpen(false)}
          onSearch={searchDocument}
          onListMatches={listFindMatches}
          onJumpToMatch={jumpToFindMatch}
          initialQuery={findQueryRef.current?.query ?? ''}
          initialCaseSensitive={findQueryRef.current?.caseSensitive ?? false}
        />
      ) : null}
      {thesaurusRequest && currentNote ? (
        <ThesaurusDialog
          initialWord={thesaurusRequest.word}
          canReplace={mode === 'edit' && !currentNoteEditLocked && thesaurusRequest.selection !== null}
          onReplace={replaceThesaurusSelection}
          onClose={() => setThesaurusRequest(null)}
        />
      ) : null}
      {activeDialog === 'broken-links' ? (
        <BrokenLinksDialog
          links={brokenLinkFilter ? brokenLinks.filter((link) => link.sourcePath === brokenLinkFilter) : brokenLinks}
          notes={flattenEntries(vault?.entries ?? [])
            .filter((entry) => entry.kind === 'note')
            .map((entry) => ({
              path: entry.path,
              title: entry.name.replace(/\.(?:md|html|htm|txt)$/i, ''),
            }))}
          entries={vault?.entries ?? []}
          filterSource={brokenLinkFilter}
          onClearFilter={() => setBrokenLinkFilter(null)}
          onCreate={(candidatePath) => void createBrokenLinkTarget(candidatePath)}
          onRetarget={(link, newPath) => void retargetBrokenLink(link, newPath)}
          onClose={closeDialog}
        />
      ) : null}
      {externalFile && !securityLocked ? (
        <ExternalFileDialog
          key={externalFile.path}
          name={externalFile.name}
          canImport={isInternallySupportedPath(externalFile.path) && !!window.a11yNotebook?.vault.importEntry}
          onClose={() => setExternalFile(null)}
          onImport={() => importInternalEntry(externalFile)}
          onOpenWith={async () => {
            const openWith = window.a11yNotebook?.vault.openWith;
            if (!openWith) throw new Error('The system application chooser is unavailable.');
            await openWith(externalFile.path);
          }}
        />
      ) : null}
      {notePasswordDialog ? (
        <NotePasswordDialog
          action={notePasswordDialog.action}
          noteName={notePasswordDialog.entry.name}
          onClose={() => setNotePasswordDialog(null)}
          onSubmit={async (password) => {
            const { action, entry } = notePasswordDialog;
            if (action === 'unlock') {
              await openEntry(entry, password);
              return;
            }
            const encrypt = window.a11yNotebook?.vault.encryptNote;
            if (!encrypt) throw new Error('Note encryption is unavailable.');
            const note = openNotes.find((item) => item.path === entry.path);
            if (!note) throw new Error('This note is no longer open.');
            await encrypt(entry.path, note.saved, password);
            setEncryptedNotePath(entry.path);
            setNotePasswordDialog(null);
            setStatusMessage('Note encrypted.');
          }}
        />
      ) : null}
      {securityLocked ? (
        <SecurityGate
          recoveryAvailable={recoveryAvailable}
          onUnlock={async (password) => {
            const unlock = window.a11yNotebook?.vault.unlockVault;
            if (!unlock) throw new Error('Library security is unavailable.');
            const opened = await unlock(password);
            setVault(opened);
            setSecurityLocked(false);
            setSecurityEnabled(true);
            setStatusMessage('Library unlocked.');
          }}
          onRecover={async (recoveryKey, newPassword) => {
            const recover = window.a11yNotebook?.vault.recoverVault;
            if (!recover) throw new Error('Library recovery is unavailable.');
            const opened = await recover(recoveryKey, newPassword);
            setVault(opened);
            setSecurityLocked(false);
            setSecurityEnabled(true);
            setRecoveryAvailable(true);
            setStatusMessage('Library password reset and library unlocked.');
          }}
        />
      ) : null}
      {activeDialog === 'note-metadata' && currentNote ? (
        <NoteMetadataDialog
          noteTitle={currentNote.title}
          content={currentNote.content}
          libraryTags={tags}
          libraryFields={metadataIndex}
          onClose={() => setActiveDialog(null)}
          onApply={(nextContent) => {
            updateNoteContent(currentNote.id, nextContent);
            setActiveDialog(null);
            setStatusMessage('Note metadata updated.');
          }}
        />
      ) : null}
      {activeDialog === 'attachment-insert' && currentNote ? (
        <InsertAttachmentDialog
          paths={allEntries.filter((entry) => entry.kind === 'attachment').map((entry) => entry.path)}
          notePath={currentNote.path}
          textareaRef={editorRef}
          announce={setStatusMessage}
          onClose={closeDialog}
          onChange={(content) => updateNoteContent(currentNote.id, content)}
        />
      ) : null}
      {activeDialog === 'web-capture' && vault ? (
        <WebCaptureDialog
          notebooks={[...notebooks.map((relative) => ({ path: relative, name: relative }))]}
          onClose={closeDialog}
          onCapture={async (url, notebookPath, format) => {
            if (openNotes.some((note) => note.content !== note.saved) || activeConflict) {
              throw new Error('Save or resolve note changes before capturing a page.');
            }
            const capture = window.a11yNotebook?.vault.captureWeb;
            if (!capture) throw new Error('Web capture is unavailable.');
            const result = await capture(url, notebookPath, format);
            setVault(result.vault);
            const entry = findEntry(result.vault.entries, result.notePath);
            if (entry) await openEntry(entry);
            setStatusMessage(
              result.omittedImages
                ? `Web page captured as ${format.toUpperCase()}. ${result.omittedImages} image${result.omittedImages === 1 ? ' was' : 's were'} unavailable; the note explains the omissions.`
                : `Web page captured as ${format.toUpperCase()} and opened as a note.`,
            );
          }}
        />
      ) : null}
      {activeDialog === 'template' ? (
        <NewFromTemplateDialog
          initialNotebookPath={selectedNotebookPath}
          notebooks={[
            ...(selectedNotebookPath ? [{ path: selectedNotebookPath, name: selectedNotebookPath }] : []),
            { path: '', name: 'Library root' },
            ...notebooks
              .filter((relative) => relative !== selectedNotebookPath)
              .map((relative) => ({ path: relative, name: relative })),
          ]}
          templates={userTemplates}
          onClose={closeDialog}
          onCreate={async (relative, content, cursor) => {
            setVault(await window.a11yNotebook!.vault.createNote(relative, content));
            await openEntry({ path: relative, name: relative.split('/').at(-1)!, kind: 'note', provenance: 'created' });
            setStatusMessage('Note created from template.');
            // A note that was just created is created to be written in:
            // Editing mode with the editor focused, regardless of the
            // default open mode.
            forceEditNoteRef.current = relative;
            pendingEditorFocusRef.current = { path: relative, cursor };
            setMode('edit');
          }}
        />
      ) : null}
      {activeDialog === 'new-task' && !securityLocked ? (
        <NewTaskDialog
          onClose={closeDialog}
          onCreate={async ({ text, due, reminder, priority }) => {
            const bridge = window.a11yNotebook?.vault;
            if (!bridge?.createTask || switchingRef.current) throw new Error('Task creation is unavailable.');
            setTasks(
              await bridge.createTask({
                notebookPath: taskCreationNotebookPath,
                text,
                due: due || undefined,
                reminder: reminder ? reminder.replace('T', ' ') : undefined,
                priority,
              }),
            );
            await refreshVault();
            setStatusMessage('Task created.');
          }}
        />
      ) : null}
      {quickTaskStep === 'library' && !securityLocked ? (
        <QuickTaskLibraryPicker
          libraries={recentLibraries}
          onPick={(path) => openLibrary(false, path)}
          onOpenLibrary={() => openLibrary(false)}
          onClose={() => setQuickTaskStep(null)}
        />
      ) : null}
      {quickTaskStep === 'task' && !securityLocked ? (
        <QuickTaskDialog
          notebookPath={quickTaskNotebookOpen}
          notebooks={
            quickTaskNotebookOpen || !vault
              ? undefined
              : flattenEntries(vault.entries)
                  .filter((entry) => entry.kind === 'notebook')
                  .map((entry) => ({ path: entry.path, name: entry.name }))
          }
          defaultNotebookPath={
            quickTaskNotebookOpen || !vault
              ? undefined
              : (() => {
                  const notebookPaths = flattenEntries(vault.entries)
                    .filter((entry) => entry.kind === 'notebook')
                    .map((entry) => entry.path);
                  // The most recent notebook is the last one recorded in
                  // settings; a deleted or renamed one falls back to the
                  // first notebook in the library. No notebooks at all
                  // leaves no default, so a destination must be picked.
                  return settings.lastNotebookPath && notebookPaths.includes(settings.lastNotebookPath)
                    ? settings.lastNotebookPath
                    : notebookPaths[0];
                })()
          }
          onCreate={async (text, notebookPath) => {
            const bridge = window.a11yNotebook?.vault;
            if (!bridge?.createTask || switchingRef.current) throw new Error('Task creation is unavailable.');
            setTasks(
              await bridge.createTask({
                notebookPath,
                text,
              }),
            );
            await refreshVault();
            const name = notebookPath
              ? findEntry(vault?.entries ?? [], notebookPath)?.name ?? notebookPath
              : vault?.name ?? 'the library';
            setStatusMessage(`Task created in ${name}.`);
          }}
          onClose={() => setQuickTaskStep(null)}
        />
      ) : null}
      {linkDialog && !securityLocked ? (
        <LinkDialog
          title={linkDialog.mode === 'add' ? 'Add link' : 'Edit link'}
          initialTitle={linkDialog.mode === 'edit' ? linkDialog.title : ''}
          initialUrl={linkDialog.mode === 'add' ? linkDialog.initialUrl : linkDialog.url}
          guidance={linkDialog.mode === 'add' ? linkDialog.guidance : undefined}
          submitLabel={linkDialog.mode === 'add' ? 'Add link' : 'Save changes'}
          onSubmit={async (title, url) => {
            const bridge = window.a11yNotebook?.vault;
            if (!bridge?.createLink || !bridge?.saveLink || switchingRef.current)
              throw new Error('Link saving is unavailable.');
            if (linkDialog.mode === 'add') {
              const created = await bridge.createLink({ title, url, notebookPath: linkDialog.notebookPath });
              setVault(created.vault);
              setTreeSelection(created.path);
              setStatusMessage(`Added link ${title}.`);
            } else {
              const saved = await bridge.saveLink({ path: linkDialog.path, title, url });
              setVault(saved.vault);
              setTreeSelection(saved.path);
              setStatusMessage(`Updated link ${title}.`);
            }
          }}
          onClose={() => setLinkDialog(null)}
        />
      ) : null}
      {transcriptionModelChoiceOpen ? (
        <TranscriptionModelDialog
          onDownload={(optionId) => void chooseTranscriptionModel(optionId)}
          onCancel={() => {
            dictationStartPendingRef.current = false;
            setTranscriptionModelChoiceOpen(false);
          }}
        />
      ) : null}
      {exportRequest ? (
        <ExportNoteDialog
          path={exportRequest.path}
          content={openNotes.find((note) => note.path === exportRequest.path)?.content ?? ''}
          sourceFormat={/\.html?$/i.test(exportRequest.path) ? 'html' : 'markdown'}
          protectedNote={exportRequest.protectedNote}
          onClose={() => setExportRequest(null)}
          onExport={async (format, protectedConsent) => {
            const bridge = window.a11yNotebook?.vault;
            if (!bridge?.exportNote) throw new Error('Note export is unavailable.');
            if (exportRequest.protectedNote && !protectedConsent)
              throw new Error('Explicit consent is required to export protected content.');
            const sourceFormat = /\.html?$/i.test(exportRequest.path) ? 'html' : 'markdown';
            const source =
              openNotes.find((note) => note.path === exportRequest.path)?.content ??
              (await bridge.readNote(exportRequest.path));
            const content =
              format === 'html'
                ? convertNoteContent(source, sourceFormat, 'html', exportRequest.path)
                : sourceFormat === 'html'
                  ? convertNoteContent(source, 'html', 'markdown', exportRequest.path)
                  : source;
            const result = await bridge.exportNote(exportRequest.path, format, content, protectedConsent);
            if (result.cancelled)
              setStatusMessage('Export cancelled. No file was created; the original note is unchanged.');
            else
              setStatusMessage(
                result.omittedImages
                  ? `Exported note. ${result.omittedImages} local image${result.omittedImages === 1 ? ' was' : 's were'} omitted.`
                  : `Exported ${format.toUpperCase()} copy. The original note is unchanged.`,
              );
          }}
        />
      ) : null}
      {!securityLocked && itemDialog ? (
        <ItemDialog
          request={itemDialog}
          notebooks={notebooks}
          onClose={() => setItemDialog(null)}
          onSubmit={submitItem}
        />
      ) : null}
      {!securityLocked && bookmarkNameRequest ? (
        <BookmarkNameDialog
          request={bookmarkNameRequest}
          onClose={() => setBookmarkNameRequest(null)}
          onSubmit={submitBookmarkName}
        />
      ) : null}
      {!securityLocked && organizeOpen && vault ? (
        <OrganizeLibraryDialog
          initialEntries={vault.entries}
          liveEntries={vault.entries}
          tasks={tasks}
          bookmarks={bookmarks}
          reminders={reminderState.reminders}
          links={links}
          hasUnsavedChanges={(path) =>
            openNotes.some(
              (note) =>
                (note.path === path || note.path.startsWith(`${path}/`)) && note.content !== note.saved,
            )
          }
          anyUnsavedChanges={() => openNotes.some((note) => note.content !== note.saved)}
          onClose={() => setOrganizeOpen(false)}
          onOpenEntry={(entry) => {
            organizeOpenedPathRef.current = entry.path;
            void openEntry(entry).catch(() => setStatusMessage('Could not open the selected file.'));
          }}
          onApplied={(ops, finalVault) => applyOrganizeResult(ops, finalVault, false)}
          onPartiallyApplied={(ops, finalVault) => applyOrganizeResult(ops, finalVault, true)}
          onVaultUpdated={setVault}
        />
      ) : null}
      {!securityLocked && propertiesPath && propertiesEntry ? (
        <ItemPropertiesDialog
          entry={propertiesEntry}
          livePath={propertiesPath}
          liveEntries={vault?.entries ?? []}
          tasks={tasks}
          bookmarks={bookmarks}
          reminders={reminderState.reminders}
          links={links}
          onClose={() => setPropertiesPath(null)}
        />
      ) : null}
      {!securityLocked && protectedRequest ? (
        <ProtectedItemDialog
          itemName={protectedRequest.targetName}
          blockingName={protectedRequest.blockingName}
          blockingIsTarget={protectedRequest.blockingIsTarget}
          action={protectedRequest.action}
          onUnprotect={handleProtectedUnprotect}
          onCancel={() => setProtectedRequest(null)}
        />
      ) : null}
      {switchingVault ? (
        <Modal
          title="Opening library"
          titleId="opening-vault-title"
          onClose={() => setStatusMessage('Wait for the folder selection or library initialization to finish.')}
        >
          <p>
            Choose a folder in the native dialog, or wait while it is opened. Editing is paused to protect your notes.
          </p>
        </Modal>
      ) : null}
      {!securityLocked && activeConflict && !itemDialog && !activeDialog ? (
        <ConflictDialog key={activeConflict.path} conflict={activeConflict} onResolve={resolveConflict} />
      ) : null}
      {deleteLibraryTarget ? (
        <DeleteLibraryDialog
          library={deleteLibraryTarget}
          permanent={deleteLibraryTarget.permanent}
          onCancel={() => setDeleteLibraryTarget(null)}
          onConfirm={() => void confirmDeleteLibrary()}
        />
      ) : null}
      {deleteGuard ? (
        <DeleteGuardDialog
          name={deleteGuard.name}
          kind={deleteGuard.kind}
          permanent={deleteGuard.permanent}
          taskCount={deleteGuard.taskCount}
          onCancel={() => setDeleteGuard(null)}
          onConfirm={() => {
            const { path, permanent } = deleteGuard;
            setDeleteGuard(null);
            void (permanent ? deleteEntryPermanently(path, false, true) : deleteEntry(path, false, true));
          }}
        />
      ) : null}
      {activeDialog === 'updates' ? (
        <UpdateDialog
          status={updater.status}
          announcement={updater.announcement}
          currentVersion={__APP_VERSION__}
          onDownload={updater.download}
          onInstallNow={updater.installNow}
          onInstallOnExit={() => {
            void updater.installOnExit().then((accepted) => {
              if (accepted) {
                closeDialog();
                setStatusMessage('The update will be installed when you exit A11y Notebook.');
              }
            });
          }}
          onRetry={updater.check}
          onClose={closeDialog}
        />
      ) : null}
    </div>
  );
}
