import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from 'react';
import {
  COMMANDS,
  cycleFocusRegions,
  dispatchCommand,
  FOCUS_REGION_ORDER,
  getCommandById,
  matchesShortcut,
  toAriaKeyShortcut,
  type CommandId,
} from '../shared/command-registry';
import { isMenuCommand } from '../shared/ipc';
import type {
  AppMode,
  FocusRegion,
  FocusTarget,
  VaultBookmark,
  VaultEntry,
  VaultInfo,
  VaultLink,
  VaultTask,
} from '../shared/types';
import CommandPalette from './components/CommandPalette';
import { AboutDialog, KeyboardShortcutsDialog, NotebookNameDialog } from './components/HelpDialogs';
import NameDialog from './components/NameDialog';
import UpdateDialog from './components/UpdateDialog';
import MarkdownDocument from './features/vault/MarkdownDocument';
import VaultTree from './features/vault/VaultTree';
import { useUpdater } from './hooks/useUpdater';

type DialogId = 'palette' | 'updates' | 'shortcuts' | 'about' | 'notebook-name';
interface NameDialogRequest {
  title: string;
  label: string;
  submitLabel: string;
  initialValue?: string;
  onSubmit: (value: string) => void | Promise<void>;
}

interface OpenNote {
  id: string;
  path: string;
  title: string;
  content: string;
  saved: string;
}

function findEntry(entries: VaultEntry[], targetPath: string | null): VaultEntry | undefined {
  for (const entry of entries) {
    if (entry.path === targetPath) return entry;
    const nested = entry.children && findEntry(entry.children, targetPath);
    if (nested) return nested;
  }
  return undefined;
}

function notebookForTask(task: VaultTask) {
  return task.path.split('/').slice(0, -1).join('/') || 'Root';
}

const TAB_PANEL_ID = 'main-tabpanel';

const REGION_LABELS: Record<FocusRegion, string> = {
  navigation: 'Navigation pane',
  tabs: 'Tabs',
  main: 'Main content',
  'right-pane': 'Right pane',
  status: 'Status bar',
};

const menuGroups: { label: string; items: CommandId[] }[] = [
  { label: 'Vault', items: ['open-vault', 'new-notebook', 'refresh-links'] },
  { label: 'Note', items: ['save-current-note', 'toggle-bookmark', 'close-current-tab'] },
  { label: 'Tasks', items: ['show-tasks'] },
  { label: 'View', items: ['toggle-right-pane', 'toggle-read-only-mode'] },
  { label: 'Window', items: ['focus-search', 'focus-navigation', 'focus-main-content', 'focus-right-pane'] },
  { label: 'Help', items: ['check-for-updates', 'show-keyboard-shortcuts', 'show-about', 'command-search'] },
];

export default function App() {
  const [activeRegion, setActiveRegion] = useState<FocusRegion>('navigation');
  const [mode, setMode] = useState<AppMode>('read-only');
  const [rightPaneOpen, setRightPaneOpen] = useState(true);
  const [activeDialog, setActiveDialog] = useState<DialogId | null>(null);
  const [nameDialog, setNameDialog] = useState<NameDialogRequest | null>(null);
  const [searchText, setSearchText] = useState('');
  const [statusMessage, setStatusMessage] = useState('Ready');
  const [selectedTab, setSelectedTab] = useState('welcome');
  const [vault, setVault] = useState<VaultInfo | null>(null);
  const [openNotes, setOpenNotes] = useState<OpenNote[]>([]);
  const [tasks, setTasks] = useState<VaultTask[]>([]);
  const [links, setLinks] = useState<VaultLink[]>([]);
  const [bookmarks, setBookmarks] = useState<VaultBookmark[]>([]);
  const [taskTabOpen, setTaskTabOpen] = useState(false);
  const [taskStatusFilter, setTaskStatusFilter] = useState<'all' | 'open' | 'done'>('open');
  const [taskDueFilter, setTaskDueFilter] = useState<'any' | 'today' | 'overdue' | 'upcoming'>('any');
  const [taskNotebookFilter, setTaskNotebookFilter] = useState('all');
  const [dueAscending, setDueAscending] = useState(true);
  const [treeSelection, setTreeSelection] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<VaultEntry[]>([]);
  const [pendingFocus, setPendingFocus] = useState<FocusTarget | null>(null);
  const updater = useUpdater();

  const searchRef = useRef<HTMLInputElement>(null);
  const navigationRef = useRef<HTMLElement>(null);
  const tabListRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const tabPanelRef = useRef<HTMLElement>(null);
  const rightPaneRef = useRef<HTMLElement>(null);
  const statusRef = useRef<HTMLElement>(null);
  const autosaveTimers = useRef(new Map<string, { content: string; timeout: number }>());
  const tabs = [
    { id: 'welcome', label: 'Welcome' },
    ...(taskTabOpen ? [{ id: 'tasks', label: 'Tasks' }] : []),
    ...openNotes.map((note) => ({
      id: note.id,
      label: `${note.title}${note.content !== note.saved ? ' (unsaved)' : ''}`,
    })),
  ];

  useEffect(() => {
    const bridge = window.a11yNotebook;
    if (bridge)
      void bridge.vault
        .get()
        .then(setVault)
        .catch(() => setStatusMessage('Could not open the last vault.'));
  }, []);

  useEffect(() => {
    if (!vault || !window.a11yNotebook) {
      setTasks([]);
      return;
    }
    void window.a11yNotebook.vault
      .getTasks()
      .then(setTasks)
      .catch(() => setStatusMessage('Could not load tasks.'));
  }, [vault]);

  useEffect(() => {
    if (!vault || !window.a11yNotebook) {
      setLinks([]);
      setBookmarks([]);
      return;
    }
    void Promise.all([window.a11yNotebook.vault.getLinkIndex(), window.a11yNotebook.vault.getBookmarks()])
      .then(([index, savedBookmarks]) => {
        setLinks(index.links);
        setBookmarks(savedBookmarks);
      })
      .catch(() => setStatusMessage('Could not refresh vault links and bookmarks.'));
  }, [vault]);

  useEffect(() => {
    const bridge = window.a11yNotebook;
    if (!bridge || !vault || !searchText.trim()) {
      setSearchResults([]);
      return;
    }
    let cancelled = false;
    const notes: VaultEntry[] = [];
    const collect = (entries: VaultEntry[]) =>
      entries.forEach((entry) => {
        if (entry.kind === 'note') notes.push(entry);
        if (entry.children) collect(entry.children);
      });
    collect(vault.entries);
    void Promise.all(
      notes.map(async (entry) => {
        const content = await bridge.vault.readNote(entry.path).catch(() => '');
        return `${entry.name}\n${content}`.toLocaleLowerCase().includes(searchText.trim().toLocaleLowerCase())
          ? entry
          : null;
      }),
    ).then((matches) => {
      if (!cancelled) setSearchResults(matches.filter((entry): entry is VaultEntry => entry !== null));
    });
    return () => {
      cancelled = true;
    };
  }, [searchText, vault]);

  const availableRegions = FOCUS_REGION_ORDER.filter((region) => region !== 'right-pane' || rightPaneOpen);

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
      const element = getFocusElement(target);
      if (!element) {
        return false;
      }
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

  const openEntry = async (entry: VaultEntry) => {
    const bridge = window.a11yNotebook;
    if (!bridge) return;
    setTreeSelection(entry.path);
    if (entry.kind === 'attachment') {
      await bridge.vault.openExternal(entry.path);
      return;
    }
    if (entry.kind !== 'note') return;
    const existingNote = openNotes.find((item) => item.id === entry.path);
    if (existingNote) {
      setSelectedTab(existingNote.id);
      return;
    }
    const content = await bridge.vault.readNote(entry.path);
    const note: OpenNote = {
      id: entry.path,
      path: entry.path,
      title: entry.name.replace(/\.md$/i, ''),
      content,
      saved: content,
    };
    setOpenNotes((current) =>
      current.some((item) => item.id === note.id)
        ? current.map((item) => (item.id === note.id ? note : item))
        : [...current, note],
    );
    setSelectedTab(note.id);
  };

  const createNote = () => {
    if (!vault || !window.a11yNotebook) {
      setStatusMessage('Open a vault before creating a note.');
      return;
    }
    const selected = findEntry(vault.entries, treeSelection);
    const parent = selected?.kind === 'notebook' ? selected : undefined;
    const parentPath = parent?.path;
    setNameDialog({
      title: 'New note',
      label: 'Note title',
      submitLabel: 'Create',
      onSubmit: async (title) => {
        const relativePath = `${parentPath ? `${parentPath}/` : ''}${title.replace(/\.md$/i, '')}.md`;
        try {
          setVault(await window.a11yNotebook!.vault.createNote(relativePath));
          await openEntry({
            name: relativePath.split('/').at(-1) ?? relativePath,
            path: relativePath,
            kind: 'note',
          });
          setStatusMessage('Note created.');
        } catch {
          setStatusMessage('Could not create the note.');
        }
      },
    });
  };

  const openNotebookNameDialog = () => {
    if (!vault || !window.a11yNotebook) {
      setStatusMessage('Open a vault before creating a notebook.');
      return;
    }
    setActiveDialog('notebook-name');
  };

  const createNotebook = (name: string) => {
    const bridge = window.a11yNotebook;
    if (!bridge) return;
    closeDialog();
    void bridge.vault
      .createNotebook(name)
      .then(setVault)
      .then(() => setStatusMessage('Notebook created.'))
      .catch(() => setStatusMessage('Could not create notebook.'));
  };

  const refreshVault = async () => {
    const latest = await window.a11yNotebook?.vault.get();
    if (latest) setVault(latest);
  };

  const refreshLinkIndex = async () => {
    const index = await window.a11yNotebook?.vault.getLinkIndex();
    const savedBookmarks = await window.a11yNotebook?.vault.getBookmarks();
    const updatedTasks = await window.a11yNotebook?.vault.getTasks();
    if (index) setLinks(index.links);
    if (savedBookmarks) setBookmarks(savedBookmarks);
    if (updatedTasks) setTasks(updatedTasks);
  };

  const openLinkTarget = async (href: string) => {
    const currentNote = openNotes.find((item) => item.id === selectedTab);
    if (!currentNote) return;
    if (href.startsWith('#') && !href.startsWith('#wiki:')) return;
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href)) {
      let url: URL;
      try {
        url = new URL(href.startsWith('//') ? `https:${href}` : href);
      } catch {
        setStatusMessage('External link is invalid.');
        return;
      }
      if (!['http:', 'https:', 'mailto:'].includes(url.protocol) || url.username || url.password) {
        setStatusMessage('This external link is not supported.');
        return;
      }
      try {
        await window.a11yNotebook?.vault.openUrl(url.href);
      } catch {
        setStatusMessage('Could not open the external link.');
      }
      return;
    }
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
      let decodedHref = cleanHref;
      try {
        decodedHref = decodeURIComponent(cleanHref);
      } catch {
        // Keep the original path when the link contains malformed percent escapes.
      }
      const base = currentNote.path.includes('/')
        ? currentNote.path.slice(0, currentNote.path.lastIndexOf('/') + 1)
        : '';
      const normalizedParts: string[] = [...base.split('/').filter(Boolean)];
      for (const part of decodedHref.split('/')) {
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

  const deleteEntry = async (entryPath: string) => {
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
      setOpenNotes((current) =>
        current.filter((item) => item.path !== entryPath && !item.path.startsWith(`${entryPath}/`)),
      );
      if (affectedNotes.some((item) => item.id === selectedTab)) setSelectedTab('welcome');
    } catch {
      setStatusMessage('Could not delete the selected item.');
    }
  };

  const renameEntry = async (entryPath: string, name: string) => {
    try {
      const updated = await window.a11yNotebook?.vault.rename(entryPath, name);
      if (!updated) return;
      setVault(updated);
      const renamedNotes = openNotes.map((note) => {
        if (note.path !== entryPath && !note.path.startsWith(`${entryPath}/`)) return note;
        const parent = entryPath.includes('/') ? entryPath.slice(0, entryPath.lastIndexOf('/') + 1) : '';
        const nextPath = `${parent}${name}${note.path.slice(entryPath.length)}`;
        const nextTitle =
          note.path === entryPath && note.path.toLowerCase().endsWith('.md') ? name.replace(/\.md$/i, '') : note.title;
        return { ...note, id: nextPath, path: nextPath, title: nextTitle };
      });
      const activeNote = openNotes.find(
        (note) => note.id === selectedTab && (note.path === entryPath || note.path.startsWith(`${entryPath}/`)),
      );
      if (activeNote) {
        const parent = entryPath.includes('/') ? entryPath.slice(0, entryPath.lastIndexOf('/') + 1) : '';
        setSelectedTab(`${parent}${name}${activeNote.path.slice(entryPath.length)}`);
      }
      setOpenNotes(renamedNotes);
    } catch {
      setStatusMessage('Could not rename the selected item.');
    }
  };

  const saveActiveNote = async () => {
    const note = openNotes.find((item) => item.id === selectedTab);
    if (!note || !window.a11yNotebook) return;
    const contentToSave = note.content;
    try {
      await window.a11yNotebook.vault.saveNote(note.path, contentToSave);
      setOpenNotes((current) =>
        current.map((item) => (item.id === note.id ? { ...item, saved: contentToSave } : item)),
      );
      setStatusMessage(`Saved ${note.title}.`);
      await refreshVault();
      await refreshLinkIndex();
    } catch {
      setStatusMessage(`Could not save ${note.title}.`);
    }
  };

  const toggleTask = async (task: VaultTask) => {
    try {
      const updated = await window.a11yNotebook?.vault.toggleTask(task.path, task.line, !task.complete);
      if (!updated) return;
      setTasks(updated);
      const nextComplete = !task.complete;
      const note = openNotes.find((item) => item.path === task.path);
      if (note) {
        const lines = note.content.split(/\r?\n/);
        const line = lines[task.line - 1];
        if (line) {
          lines[task.line - 1] = line.replace(/^(\s*[-*+]\s+\[)[ xX](\]\s+)/, `$1${nextComplete ? 'x' : ' '}$2`);
          const newline = note.content.includes('\r\n') ? '\r\n' : '\n';
          const content = lines.join(newline);
          setOpenNotes((current) =>
            current.map((item) => (item.id === note.id ? { ...item, content, saved: content } : item)),
          );
        }
      }
      setStatusMessage(nextComplete ? 'Task marked complete.' : 'Task marked open.');
    } catch {
      setStatusMessage('Could not update the task.');
    }
  };

  const cancelAutosaves = () => {
    autosaveTimers.current.forEach(({ timeout }) => window.clearTimeout(timeout));
    autosaveTimers.current.clear();
  };

  useEffect(() => {
    const bridge = window.a11yNotebook;
    for (const [noteId, timer] of autosaveTimers.current) {
      const note = openNotes.find((item) => item.id === noteId);
      if (!note || note.content === note.saved || note.content !== timer.content) {
        window.clearTimeout(timer.timeout);
        autosaveTimers.current.delete(noteId);
      }
    }
    if (!bridge) return;
    openNotes.forEach((note) => {
      if (note.content === note.saved || autosaveTimers.current.has(note.id)) return;
      const contentToSave = note.content;
      const timeout = window.setTimeout(() => {
        autosaveTimers.current.delete(note.id);
        void bridge.vault
          .saveNote(note.path, contentToSave)
          .then(() => {
            setOpenNotes((current) =>
              current.map((item) => (item.id === note.id ? { ...item, saved: contentToSave } : item)),
            );
            setStatusMessage(`Saved ${note.title}.`);
            void refreshLinkIndex();
          })
          .catch(() => setStatusMessage(`Could not save ${note.title}.`));
      }, 900);
      autosaveTimers.current.set(note.id, { content: contentToSave, timeout });
    });
  }, [openNotes]);

  useEffect(
    () => () => {
      autosaveTimers.current.forEach(({ timeout }) => window.clearTimeout(timeout));
      autosaveTimers.current.clear();
    },
    [],
  );

  const handleCommand = (commandId: CommandId) => {
    if (commandId === 'open-vault') {
      const bridge = window.a11yNotebook;
      if (!bridge) return;
      if (
        openNotes.some((note) => note.content !== note.saved) &&
        !window.confirm('Opening another vault will discard unsaved note changes. Continue?')
      ) {
        return;
      }
      cancelAutosaves();
      void bridge.vault
        .open()
        .then((opened) => {
          if (opened) {
            setVault(opened);
            setOpenNotes([]);
            setSelectedTab('welcome');
            setStatusMessage(`Opened vault ${opened.name}.`);
          }
        })
        .catch(() => setStatusMessage('Could not open the selected vault.'));
      return;
    }
    if (commandId === 'new-notebook') {
      openNotebookNameDialog();
      return;
    }
    if (commandId === 'refresh-links') {
      void refreshVault().then(refreshLinkIndex);
      setStatusMessage('Vault and links refreshed.');
      return;
    }
    if (commandId === 'close-current-tab') {
      if (selectedTab === 'tasks') {
        setTaskTabOpen(false);
        setSelectedTab('welcome');
        return;
      }
      const note = openNotes.find((item) => item.id === selectedTab);
      if (!note) return;
      if (note.content !== note.saved && !window.confirm(`Discard unsaved changes to ${note.title}?`)) return;
      setOpenNotes((current) => current.filter((item) => item.id !== note.id));
      setSelectedTab('welcome');
      setStatusMessage(`Closed ${note.title}.`);
      return;
    }
    if (activeDialog === 'palette' && commandId !== 'command-search') {
      setActiveDialog(null);
    }
    const result = dispatchCommand(commandId, {
      mode,
      rightPaneOpen,
      setMode,
      setRightPaneOpen,
      setCommandPaletteOpen: (open) => setActiveDialog(open ? 'palette' : null),
      setSelectedTab,
      saveNote: () => void saveActiveNote(),
      showTasks: () => {
        setTaskTabOpen(true);
        setSelectedTab('tasks');
      },
      toggleBookmark: () => void toggleActiveBookmark(),
      focusTarget: setPendingFocus,
      checkForUpdates,
      showKeyboardShortcuts: () => setActiveDialog('shortcuts'),
      showAbout: () => setActiveDialog('about'),
    });
    if (result) {
      setStatusMessage(result);
    }
  };

  const handleGlobalKeyDown = (event: KeyboardEvent) => {
    // Open dialogs manage their own keyboard interaction (Tab trapping and Escape).
    if (activeDialog || nameDialog || document.querySelector('[role="dialog"][aria-modal="true"]')) {
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
    if (event.key === 'Tab' && event.ctrlKey) {
      event.preventDefault();
      const currentIndex = tabs.findIndex((tab) => tab.id === selectedTab);
      const nextIndex = (currentIndex + (event.shiftKey ? -1 : 1) + tabs.length) % tabs.length;
      setSelectedTab(tabs[nextIndex].id);
      return;
    }
    const command = COMMANDS.find((item) => item.shortcut && matchesShortcut(event, item.shortcut));
    if (command) {
      event.preventDefault();
      handleCommand(command.id);
    }
  };

  // Always call the latest handler without re-registering the listener on every render.
  const keyDownHandlerRef = useRef(handleGlobalKeyDown);
  keyDownHandlerRef.current = handleGlobalKeyDown;
  useEffect(() => {
    const listener = (event: KeyboardEvent) => keyDownHandlerRef.current(event);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  // Commands chosen from the native Windows menu (Help menu items).
  const menuCommandHandlerRef = useRef(handleCommand);
  menuCommandHandlerRef.current = handleCommand;
  useEffect(() => {
    const bridge = window.a11yNotebook;
    if (!bridge) {
      return undefined;
    }
    return bridge.onMenuCommand((command) => {
      if (isMenuCommand(command)) {
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

  const currentNote = openNotes.find((item) => item.id === selectedTab);
  const date = new Date();
  const today = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const taskNotebooks = [...new Set(tasks.map(notebookForTask))];
  const visibleTasks = tasks
    .filter((task) => taskStatusFilter === 'all' || (taskStatusFilter === 'done') === task.complete)
    .filter((task) => taskNotebookFilter === 'all' || notebookForTask(task) === taskNotebookFilter)
    .filter((task) => {
      if (taskDueFilter === 'any') return true;
      if (taskDueFilter === 'today') return task.dueDate === today;
      if (taskDueFilter === 'overdue') return !task.complete && Boolean(task.dueDate && task.dueDate < today);
      return !task.complete && Boolean(task.dueDate && task.dueDate > today);
    })
    .sort((left, right) => {
      const leftDate = left.dueDate ?? '9999-12-31';
      const rightDate = right.dueDate ?? '9999-12-31';
      return leftDate.localeCompare(rightDate) * (dueAscending ? 1 : -1);
    });
  const downloadPercent = updater.status.state === 'download-progress' ? updater.status.percent : null;
  useEffect(() => {
    document.title =
      currentNote && vault
        ? `${currentNote.title} – ${vault.name} – A11y Notebook`
        : `A11y Notebook${vault ? ` – ${vault.name}` : ''}`;
  }, [currentNote, vault]);

  return (
    <div className="app-shell" aria-label="A11y Notebook application shell">
      <header className="app-header" aria-label="Application header">
        <div className="title-block">
          <h1>A11y Notebook</h1>
          <span className="current-item">
            {currentNote?.title ?? 'No note open'} / {vault?.name ?? 'No vault open'}
          </span>
        </div>
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
            placeholder="Search vault, notes, tasks, files"
          />
        </div>
      </header>

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
                    onClick={() => handleCommand(command.id)}
                    aria-keyshortcuts={command.shortcut ? toAriaKeyShortcut(command.shortcut) : undefined}
                  >
                    {command.label}
                  </button>
                );
              })}
            </div>
          );
        })}
      </nav>

      <main className="workspace" aria-label="Workspace layout">
        <aside
          ref={navigationRef}
          className={activeRegion === 'navigation' ? 'panel active-panel' : 'panel'}
          data-region="navigation"
          aria-label="Navigation pane"
          tabIndex={-1}
        >
          <h2>{vault?.name ?? 'Vault'}</h2>
          <div className="vault-actions">
            <button type="button" onClick={() => handleCommand('show-tasks')} disabled={!vault}>
              Open Tasks
            </button>
            <button type="button" onClick={() => void createNote()} disabled={!vault}>
              New note
            </button>
            <button type="button" onClick={() => handleCommand('new-notebook')} disabled={!vault}>
              New notebook
            </button>
            <button
              type="button"
              onClick={() => {
                if (
                  treeSelection &&
                  findEntry(vault?.entries ?? [], treeSelection)?.kind === 'notebook' &&
                  window.a11yNotebook
                )
                  void window.a11yNotebook.vault
                    .importFile(treeSelection)
                    .then((updated) => updated && setVault(updated));
                else setStatusMessage('Select a notebook before importing a file.');
              }}
              disabled={!vault || findEntry(vault.entries, treeSelection)?.kind !== 'notebook'}
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
              onClick={() => treeSelection && void window.a11yNotebook?.vault.openExternal(treeSelection)}
              disabled={!treeSelection}
            >
              Open in external app
            </button>
          </div>
          {vault ? (
            <VaultTree
              entries={vault.entries}
              selectedPath={treeSelection}
              onSelect={(entry) => setTreeSelection(entry.path)}
              onOpen={(entry) => void openEntry(entry)}
              onRename={(entryPath, name) => void renameEntry(entryPath, name)}
              onDelete={(entryPath) => void deleteEntry(entryPath)}
            />
          ) : (
            <p>Open a folder as a local vault from the Vault menu.</p>
          )}
          {searchResults.length ? (
            <section aria-label="Search results">
              <h3>Search results</h3>
              <p role="status" aria-live="polite">
                {searchResults.length} results.
              </p>
              <ul>
                {searchResults.map((entry) => (
                  <li key={entry.path}>
                    <button type="button" onClick={() => void openEntry(entry)}>
                      {entry.name}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </aside>

        <section className="content-panel" aria-label="Main content">
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
                    id={`tab-${encodeURIComponent(tab.id)}`}
                    type="button"
                    className={selected ? 'tab active-tab' : 'tab'}
                    role="tab"
                    aria-selected={selected}
                    aria-controls={TAB_PANEL_ID}
                    aria-label={tab.label}
                    tabIndex={selected ? 0 : -1}
                    onClick={() => setSelectedTab(tab.id)}
                    onKeyDown={(event) => handleTabKeyDown(event, index)}
                  >
                    {tab.label}
                  </button>
                  {tab.id !== 'welcome' ? (
                    <button
                      type="button"
                      className="close-tab"
                      aria-label={`Close ${tab.label}`}
                      onClick={() => {
                        if (tab.id === 'tasks') {
                          setTaskTabOpen(false);
                          if (selected) setSelectedTab('welcome');
                          return;
                        }
                        const note = openNotes.find((item) => item.id === tab.id);
                        if (
                          note &&
                          note.content !== note.saved &&
                          !window.confirm(`Discard unsaved changes to ${note.title}?`)
                        )
                          return;
                        setOpenNotes((current) => current.filter((item) => item.id !== tab.id));
                        if (selected) setSelectedTab('welcome');
                      }}
                    >
                      ×
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>

          <article
            ref={tabPanelRef}
            id={TAB_PANEL_ID}
            className={activeRegion === 'main' ? 'document active-panel' : 'document'}
            data-region="main"
            role="tabpanel"
            aria-labelledby={`tab-${encodeURIComponent(selectedTab)}`}
            tabIndex={0}
          >
            {selectedTab === 'tasks' ? (
              <section aria-labelledby="tasks-heading">
                <h2 id="tasks-heading">Tasks</h2>
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
                    <caption>Markdown checkbox tasks in the open vault</caption>
                    <thead>
                      <tr>
                        <th scope="col">Task</th>
                        <th scope="col">Notebook</th>
                        <th scope="col" aria-sort={dueAscending ? 'ascending' : 'descending'}>
                          <button type="button" onClick={() => setDueAscending((ascending) => !ascending)}>
                            Due date
                          </button>
                        </th>
                        <th scope="col">Priority</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleTasks.map((task) => (
                        <tr key={task.id}>
                          <th scope="row">
                            <label>
                              <input type="checkbox" checked={task.complete} onChange={() => void toggleTask(task)} />
                              {task.text}
                            </label>
                          </th>
                          <td>{notebookForTask(task)}</td>
                          <td>{task.dueDate ?? 'No due date'}</td>
                          <td>{task.priority ?? 'Normal'}</td>
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
                {mode === 'read-only' ? (
                  <button type="button" onClick={() => void toggleActiveBookmark()}>
                    {bookmarks.some((bookmark) => bookmark.path === currentNote.path)
                      ? 'Remove bookmark'
                      : 'Bookmark note'}
                  </button>
                ) : null}
                {mode === 'edit' ? (
                  <button type="button" onClick={() => void saveActiveNote()}>
                    Save note
                  </button>
                ) : null}
                <MarkdownDocument
                  content={currentNote.content}
                  mode={mode}
                  links={links.filter((link) => link.sourcePath === currentNote.path)}
                  onChange={(content) =>
                    setOpenNotes((current) =>
                      current.map((note) => (note.id === currentNote.id ? { ...note, content } : note)),
                    )
                  }
                  onNavigate={(href) => void openLinkTarget(href)}
                />
              </>
            ) : (
              <div className="document-body">
                <h2>Welcome to A11y Notebook</h2>
                <p>Open or create a local vault to begin organizing Markdown notes and attachments.</p>
                <p>
                  Use F6 and Shift+F6 to move between panes, Ctrl+K for commands, and Ctrl+E to switch read/edit mode.
                </p>
              </div>
            )}
          </article>
        </section>

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
                            <span>{link.targetTitle}, missing note</span>
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
                {bookmarks.map((bookmark) => (
                  <li key={bookmark.id}>
                    <button
                      type="button"
                      onClick={() => {
                        const entry = findEntry(vault?.entries ?? [], bookmark.path);
                        if (entry) void openEntry(entry);
                      }}
                    >
                      {bookmark.title}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
            <section aria-labelledby="tasks-heading-right">
              <h3 id="tasks-heading-right">Tasks</h3>
              <ul>
                {tasks
                  .filter((task) => !task.complete)
                  .slice(0, 10)
                  .map((task) => (
                    <li key={task.id}>
                      {task.text}
                      {task.dueDate ? `, due ${task.dueDate}` : ''}
                    </li>
                  ))}
              </ul>
            </section>
          </aside>
        ) : null}
      </main>

      <footer ref={statusRef} className="status-bar" data-region="status" aria-label="Status bar" tabIndex={-1}>
        <span className="status-message" role="status" aria-live="polite">
          {statusMessage}
        </span>
        {downloadPercent !== null ? <span>Update download: {downloadPercent}%</span> : null}
        <span>Pane: {REGION_LABELS[activeRegion]}</span>
        <span>Mode: {mode}</span>
      </footer>

      {activeDialog === 'palette' ? <CommandPalette onRun={handleCommand} onClose={closeDialog} /> : null}
      {activeDialog === 'shortcuts' ? <KeyboardShortcutsDialog onClose={closeDialog} /> : null}
      {activeDialog === 'about' ? <AboutDialog onClose={closeDialog} /> : null}
      {activeDialog === 'notebook-name' ? <NotebookNameDialog onCreate={createNotebook} onClose={closeDialog} /> : null}
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
      {nameDialog ? (
        <NameDialog
          title={nameDialog.title}
          label={nameDialog.label}
          initialValue={nameDialog.initialValue}
          submitLabel={nameDialog.submitLabel}
          onSubmit={(value) => {
            const { onSubmit } = nameDialog;
            setNameDialog(null);
            void onSubmit(value);
          }}
          onClose={() => setNameDialog(null)}
        />
      ) : null}
    </div>
  );
}
