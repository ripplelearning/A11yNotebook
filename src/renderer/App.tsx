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
import { AboutDialog, KeyboardShortcutsDialog } from './components/HelpDialogs';
import UpdateDialog from './components/UpdateDialog';
import MarkdownDocument from './features/vault/MarkdownDocument';
import VaultTree from './features/vault/VaultTree';
import { useUpdater } from './hooks/useUpdater';
import type { OpenNote } from './features/vault/open-note';
import { useVaultChanges } from './hooks/useVaultChanges';
import ConflictDialog from './features/vault/ConflictDialog';
import ItemDialog, { type ItemDialogRequest } from './features/vault/ItemDialog';
import type { TreeAction } from './features/vault/TreeContextMenu';
import SearchResults from './features/search/SearchResults';
import type { VaultSearchQuery, VaultSearchResult } from '../shared/search';
import SettingsDialog from './features/settings/SettingsDialog';
import { DEFAULT_SETTINGS, type NotebookSettings } from '../shared/settings';
import AttachmentView from './features/previews/AttachmentView';
import type { AttachmentPreview } from '../shared/attachments';
import EditorTools, { type EditorToolsHandle } from './features/editor/EditorTools';
import NewFromTemplateDialog from './features/templates/NewFromTemplateDialog';
import type { NoteTemplate } from '../shared/templates';
import { useAnnotations } from './features/annotations/useAnnotations';
import type { NoteAnnotation } from '../shared/annotations';
import RemindersView from './features/reminders/RemindersView';
import TaskProgressSummaries from './features/reminders/TaskProgressSummaries';
import { useReminders } from './hooks/useReminders';
import AssetsWorkspace from './features/assets/AssetsWorkspace';
import { assetTypes, createAssetRegistry } from '../shared/assets';
import InsertAttachmentDialog from './features/editor/InsertAttachmentDialog';
import Modal from './components/Modal';
import SecurityGate from './features/security/SecurityGate';
import NotePasswordDialog from './features/security/NotePasswordDialog';
import WebCaptureDialog from './features/previews/WebCaptureDialog';

type DialogId =
  'palette' | 'updates' | 'shortcuts' | 'about' | 'settings' | 'template' | 'attachment-insert' | 'web-capture';

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

function notebookForTask(task: VaultTask) {
  return task.path.split('/').slice(0, -1).join('/') || 'Root';
}

const TAB_PANEL_ID = 'main-tabpanel';
const assetRegistry = createAssetRegistry(assetTypes);

const REGION_LABELS: Record<FocusRegion, string> = {
  navigation: 'Navigation pane',
  tabs: 'Tabs',
  main: 'Main content',
  'right-pane': 'Right pane',
  status: 'Status bar',
};

const menuGroups: { label: string; items: CommandId[] }[] = [
  { label: 'Vault', items: ['open-vault', 'new-notebook', 'refresh-links'] },
  {
    label: 'Note',
    items: ['save-current-note', 'new-from-template', 'annotate-selection', 'toggle-bookmark', 'close-current-tab'],
  },
  {
    label: 'Format',
    items: [
      'format-bold',
      'format-italic',
      'format-heading1',
      'format-heading2',
      'format-heading3',
      'format-bullet',
      'format-numbered',
      'format-checkbox',
      'format-quote',
      'format-code',
      'insert-link',
      'insert-table',
      'insert-attachment',
    ],
  },
  { label: 'Tasks', items: ['show-tasks', 'show-reminders'] },
  { label: 'View', items: ['toggle-right-pane', 'toggle-read-only-mode', 'show-settings', 'show-assets'] },
  { label: 'Window', items: ['focus-search', 'focus-navigation', 'focus-main-content', 'focus-right-pane'] },
  { label: 'Help', items: ['check-for-updates', 'show-keyboard-shortcuts', 'show-about', 'command-search'] },
];

export default function App() {
  const [activeRegion, setActiveRegion] = useState<FocusRegion>('navigation');
  const [mode, setMode] = useState<AppMode>('read-only');
  const [rightPaneOpen, setRightPaneOpen] = useState(true);
  const [activeDialog, setActiveDialog] = useState<DialogId | null>(null);
  const [searchText, setSearchText] = useState('');
  const [statusMessage, setStatusMessage] = useState('Ready');
  const [selectedTab, setSelectedTab] = useState('welcome');
  const [vault, setVault] = useState<VaultInfo | null>(null);
  const [openNotes, setOpenNotes] = useState<OpenNote[]>([]);
  const [tasks, setTasks] = useState<VaultTask[]>([]);
  const [links, setLinks] = useState<VaultLink[]>([]);
  const [bookmarks, setBookmarks] = useState<VaultBookmark[]>([]);
  const [taskTabOpen, setTaskTabOpen] = useState(false);
  const [reminderTabOpen, setReminderTabOpen] = useState(false);
  const [assetTabOpen, setAssetTabOpen] = useState(false);
  const [assetInitialPath, setAssetInitialPath] = useState<string | undefined>();
  const [assetDirty, setAssetDirty] = useState(false);
  const [assetBusy, setAssetBusy] = useState(false);
  const [assetSelectionVersion, setAssetSelectionVersion] = useState(0);
  const [switchingVault, setSwitchingVault] = useState(false);
  const switchingRef = useRef(false);
  const vaultGenerationRef = useRef(0);
  const vaultPathRef = useRef(vault?.path);
  vaultPathRef.current = vault?.path;
  const updateNoteContent = (id: string, content: string) => {
    if (switchingRef.current) return;
    setOpenNotes((items) => items.map((note) => (note.id === id ? { ...note, content } : note)));
  };
  const [taskStatusFilter, setTaskStatusFilter] = useState<'all' | 'open' | 'done'>('open');
  const [taskDueFilter, setTaskDueFilter] = useState<'any' | 'today' | 'overdue' | 'upcoming'>('any');
  const [taskNotebookFilter, setTaskNotebookFilter] = useState('all');
  const [dueAscending, setDueAscending] = useState(true);
  const [treeSelection, setTreeSelection] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<VaultSearchResult[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [searchFilters, setSearchFilters] = useState<Omit<VaultSearchQuery, 'text'>>({});
  const [settings, setSettings] = useState<NotebookSettings>(DEFAULT_SETTINGS);
  const [securityEnabled, setSecurityEnabled] = useState(false);
  const [securityLocked, setSecurityLocked] = useState(false);
  const [lockedEditPaths, setLockedEditPaths] = useState<Set<string>>(() => new Set());
  const [encryptedNotePath, setEncryptedNotePath] = useState<string | null>(null);
  const [notePasswordDialog, setNotePasswordDialog] = useState<{
    action: 'encrypt' | 'unlock';
    entry: VaultEntry;
  } | null>(null);
  const [itemDialog, setItemDialog] = useState<ItemDialogRequest | null>(null);
  const [attachment, setAttachment] = useState<AttachmentPreview | null>(null);
  const [imageAlt, setImageAlt] = useState('');
  const [noteAnnotations, setNoteAnnotations] = useState<NoteAnnotation[]>([]);
  const [userTemplates, setUserTemplates] = useState<NoteTemplate[]>([]);
  const [pendingFocus, setPendingFocus] = useState<FocusTarget | null>(null);
  const updater = useUpdater();
  const synchronization = useVaultChanges(vault, openNotes, setOpenNotes, setVault, setStatusMessage);
  const { checking: checkingDisk, checkDisk, clearAllConflicts } = synchronization;
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const editorToolsRef = useRef<EditorToolsHandle>(null);
  const editLockStart = useRef<{ path: string; timestamp: number } | null>(null);
  const currentNote = openNotes.find((item) => item.id === selectedTab);
  const currentEditLockKey = currentNote && vault ? `${vault.path}\0${currentNote.path}` : null;
  const currentNoteEditLocked = !!currentEditLockKey && lockedEditPaths.has(currentEditLockKey);
  const allEntries = flattenEntries(vault?.entries ?? []);
  const notebooks = allEntries.filter((entry) => entry.kind === 'notebook').map((entry) => entry.path);
  const notePaths = allEntries.filter((entry) => entry.kind === 'note').map((entry) => entry.path);
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
    if (editLockStart.current?.path !== path) editLockStart.current = { path, timestamp: Date.now() };
    const remaining = (settings.noteEditLockMinutes ?? 0) * 60_000 - (Date.now() - editLockStart.current.timestamp);
    const timer = window.setTimeout(
      () => {
        setLockedEditPaths((paths) => new Set(paths).add(`${vault?.path ?? ''}\0${path}`));
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
    { id: 'welcome', label: 'Welcome' },
    ...(taskTabOpen ? [{ id: 'tasks', label: 'Tasks' }] : []),
    ...(reminderTabOpen ? [{ id: 'reminders', label: 'Reminders' }] : []),
    ...(assetTabOpen ? [{ id: 'assets', label: 'Cognitive tools' }] : []),
    ...(attachment ? [{ id: 'attachment', label: attachment.path.split('/').at(-1) ?? attachment.path }] : []),
    ...openNotes.map((note) => ({
      id: note.id,
      label: `${note.title}${note.content !== note.saved ? ' (unsaved)' : ''}`,
    })),
  ];
  const reminderState = useReminders(
    vault?.path,
    (relative) => {
      if (switchingRef.current) return;
      const entry = findEntry(vault?.entries ?? [], relative);
      if (entry) void openEntry(entry).catch(() => setStatusMessage('Could not open reminder note.'));
      else setStatusMessage('The reminder note is no longer available in this vault.');
    },
    setStatusMessage,
  );

  useEffect(() => {
    let cancelled = false;
    if (securityLocked) return;
    void window.a11yNotebook?.vault
      .getSettings?.()
      .then((value) => {
        if (!cancelled) setSettings(value);
      })
      .catch(() => setStatusMessage('Could not load settings.'));
    return () => {
      cancelled = true;
    };
  }, [vault?.path, securityLocked]);

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
    document.documentElement.style.fontSize = `${settings.fontSize}px`;
  }, [settings.theme, settings.fontSize]);

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
          if (!switchingRef.current && generation === vaultGenerationRef.current) setVault(latest);
        })
        .catch(() => setStatusMessage('Could not open the last vault.'));
  }, []);

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
          }
        })
        .catch(() => setStatusMessage('Could not read vault security status.'));
    }
    return () => {
      cancelled = true;
    };
  }, [vault?.path]);

  useEffect(() => {
    const unsubscribe = window.a11yNotebook?.vault.onSecurityLocked?.(() => {
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
      setAssetTabOpen(false);
      setAssetDirty(false);
      setMode('read-only');
      setVault((current) => (current ? { ...current, entries: [] } : current));
      setStatusMessage('Vault locked. Unlock it to continue.');
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

  useEffect(() => {
    let cancelled = false;
    if (!vault || !window.a11yNotebook) {
      setTasks([]);
      return;
    }
    void window.a11yNotebook.vault
      .getTasks()
      .then((items) => {
        if (!cancelled) setTasks(items);
      })
      .catch(() => setStatusMessage('Could not load tasks.'));
    return () => {
      cancelled = true;
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
      .catch(() => setStatusMessage('Could not refresh vault links and bookmarks.'));
    return () => {
      cancelled = true;
    };
  }, [vault]);

  useEffect(() => {
    const bridge = window.a11yNotebook;
    const active = searchText.trim() || Object.values(searchFilters).some(Boolean);
    if (!bridge || !vault || !active) {
      setSearchResults([]);
      return;
    }
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      void bridge.vault
        .search({ text: searchText, ...searchFilters, limit: 100 })
        .then((matches) => {
          if (!cancelled) {
            setSearchResults(matches);
            setStatusMessage(`${matches.length} search results shown.`);
          }
        })
        .catch(() => {
          if (!cancelled) setStatusMessage('Could not query the search index.');
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [searchText, searchFilters, vault]);

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

  const openEntry = async (entry: VaultEntry, notePassword?: string) => {
    const bridge = window.a11yNotebook;
    if (!bridge || switchingRef.current) return;
    const root = vaultPathRef.current;
    setTreeSelection(entry.path);
    if (assetRegistry.resolve(entry.path)) {
      if (assetDirty || assetBusy) {
        setStatusMessage('Save cognitive asset changes and wait for pending operations before opening another asset.');
        return;
      }
      setAssetInitialPath(entry.path);
      setAssetSelectionVersion((version) => version + 1);
      setAssetTabOpen(true);
      setSelectedTab('assets');
      return;
    }
    if (entry.kind === 'attachment') {
      if (/\.(?:txt|csv|html?|pdf|epub)$/i.test(entry.path)) {
        const preview = await bridge.vault.readAttachment(entry.path);
        if (switchingRef.current || vaultPathRef.current !== root) return;
        setAttachment(preview);
        setSelectedTab('attachment');
      } else if (/\.(?:png|jpe?g|gif|webp|bmp)$/i.test(entry.path)) {
        const alt = await bridge.vault.getImageAlt(entry.path);
        if (switchingRef.current || vaultPathRef.current !== root) return;
        setImageAlt(alt);
        setAttachment({ path: entry.path, text: '', kind: 'image' });
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
      setSelectedTab(existingNote.id);
      return;
    }
    let content: string;
    try {
      content = await bridge.vault.readNote(entry.path, notePassword);
    } catch (error) {
      if (!notePassword && error instanceof Error && /note’s password/i.test(error.message)) {
        setNotePasswordDialog({ action: 'unlock', entry });
        return;
      }
      throw error;
    }
    if (switchingRef.current || vaultPathRef.current !== root) return;
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
    setNotePasswordDialog(null);
  };

  const createNote = async () => {
    if (!vault || !window.a11yNotebook) {
      setStatusMessage('Open a vault before creating a note.');
      return;
    }
    setItemDialog({ action: 'new-note' });
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

  const refreshLinkIndex = async () => {
    const root = vaultPathRef.current;
    const generation = vaultGenerationRef.current;
    const index = await window.a11yNotebook?.vault.getLinkIndex();
    const savedBookmarks = await window.a11yNotebook?.vault.getBookmarks();
    if (switchingRef.current || vaultPathRef.current !== root || generation !== vaultGenerationRef.current) return;
    if (index) setLinks(index.links);
    if (savedBookmarks) setBookmarks(savedBookmarks);
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
      if (findEntry(updated.entries, entryPath)) return;
      setOpenNotes((current) =>
        current.filter((item) => item.path !== entryPath && !item.path.startsWith(`${entryPath}/`)),
      );
      if (affectedNotes.some((item) => item.id === selectedTab)) setSelectedTab('welcome');
    } catch {
      setStatusMessage('Could not delete the selected item.');
    }
  };

  const renameEntry = (entryPath: string) => {
    setItemDialog({ action: 'rename', path: entryPath, name: entryPath.split('/').at(-1) });
  };

  const submitItem = async (name: string, notebook: string) => {
    const bridge = window.a11yNotebook?.vault;
    if (!bridge || !vault || !itemDialog) return;
    const request = itemDialog;
    if (request.action === 'new-note' || request.action === 'new-notebook') {
      const selected = findEntry(vault.entries, treeSelection);
      const parent =
        selected?.kind === 'notebook' ? selected.path : (selected?.path.split('/').slice(0, -1).join('/') ?? '');
      const leaf = request.action === 'new-note' ? `${name.replace(/\.md$/i, '')}.md` : name;
      const relative = [parent, leaf].filter(Boolean).join('/');
      setVault(
        request.action === 'new-note' ? await bridge.createNote(relative) : await bridge.createNotebook(relative),
      );
      if (request.action === 'new-note') await openEntry({ name: leaf, path: relative, kind: 'note' });
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
    const updated =
      request.action === 'rename' ? await bridge.rename(source, name) : await bridge.move(source, destination);
    setVault(updated);
    if (findEntry(updated.entries, source)) return; // Native confirmation was cancelled.
    const moved = (relative: string) =>
      relative === source || relative.startsWith(`${source}/`) ? destination + relative.slice(source.length) : relative;
    const refreshed = await Promise.all(
      openNotes.map(async (note) => {
        const nextPath = moved(note.path);
        const content = await bridge.readNote(nextPath);
        return {
          ...note,
          id: nextPath,
          path: nextPath,
          title: nextPath.split('/').at(-1)!.replace(/\.md$/i, ''),
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
    setTreeSelection(entry.path);
    if (action === 'new-note') setItemDialog({ action: 'new-note' });
    else if (action === 'new-template') handleCommand('new-from-template');
    else if (action === 'rename') renameEntry(entry.path);
    else if (action === 'move') setItemDialog({ action: 'move', path: entry.path });
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

  const resolveConflict = async (choice: 'mine' | 'disk' | 'copy') => {
    if (!activeConflict || !window.a11yNotebook) return;
    const note = openNotes.find((item) => item.path === activeConflict.path);
    if (!note) return;
    const bridge = window.a11yNotebook.vault;
    if (choice === 'copy') {
      const copyPath = note.path.replace(/\.md$/i, ` (conflict copy ${Date.now()}).md`);
      setVault(await bridge.createNote(copyPath, note.content));
      setOpenNotes((items) => items.filter((item) => item.path !== note.path));
      synchronization.clearConflict(note.path);
      await openEntry({ name: copyPath.split('/').at(-1)!, path: copyPath, kind: 'note' });
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
        const lockKey = `${vault?.path ?? ''}\0${note.path}`;
        setLockedEditPaths((paths) => {
          const updated = new Set(paths);
          updated.delete(lockKey);
          return updated;
        });
      }
      setOpenNotes((items) =>
        items.map((item) => (item.path === note.path ? { ...item, content, saved: content } : item)),
      );
      synchronization.clearConflict(note.path);
    }
    setStatusMessage('Note conflict resolved.');
  };

  const saveActiveNote = async () => {
    const note = openNotes.find((item) => item.id === selectedTab);
    if (!note || !window.a11yNotebook || activeConflict || synchronization.checking) return;
    const contentToSave = note.content;
    try {
      await window.a11yNotebook.vault.saveNote(note.path, contentToSave, note.saved);
      setOpenNotes((current) =>
        current.map((item) => (item.id === note.id ? { ...item, saved: contentToSave } : item)),
      );
      const lockKey = `${vault?.path ?? ''}\0${note.path}`;
      setLockedEditPaths((paths) => {
        const updated = new Set(paths);
        updated.delete(lockKey);
        return updated;
      });
      setStatusMessage(`Saved ${note.title}.`);
      await refreshVault();
      await refreshLinkIndex();
    } catch {
      setStatusMessage(`Could not save ${note.title}.`);
      await synchronization.checkDisk(note.path);
    }
  };

  const toggleTask = async (task: VaultTask) => {
    if (openNotes.some((note) => note.path === task.path && note.content !== note.saved) || activeConflict) {
      setStatusMessage('Save or resolve unsaved note changes before toggling this task.');
      return;
    }
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
          const content = lines.join('\n');
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
    const contentToSave = note.content;
    const timeout = window.setTimeout(() => {
      void window.a11yNotebook?.vault
        .saveNote(note.path, contentToSave, note.saved)
        .then(() => {
          setOpenNotes((current) =>
            current.map((item) => (item.id === note.id ? { ...item, saved: contentToSave } : item)),
          );
          const lockKey = `${vault?.path ?? ''}\0${note.path}`;
          setLockedEditPaths((paths) => {
            const updated = new Set(paths);
            updated.delete(lockKey);
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
  }, [openNotes, selectedTab, activeConflict, checkingDisk, checkDisk, settings.autosaveDelay, itemDialog]);

  const handleCommand = (commandId: CommandId) => {
    if (switchingRef.current) return;
    if (commandId === 'insert-attachment') {
      if (!currentNote || mode !== 'edit') {
        setStatusMessage('Open a note in edit mode first.');
        return;
      }
      setActiveDialog('attachment-insert');
      return;
    }
    if (commandId !== 'command-search' && activeDialog === 'palette') setActiveDialog(null);
    if (commandId === 'show-settings') {
      setActiveDialog('settings');
      return;
    }
    if (commandId === 'show-reminders') {
      setReminderTabOpen(true);
      setSelectedTab('reminders');
      return;
    }
    if (commandId === 'show-assets') {
      if (!vault) {
        setStatusMessage('Open a vault before using cognitive tools.');
        return;
      }
      setAssetTabOpen(true);
      setSelectedTab('assets');
      return;
    }
    if (commandId === 'new-from-template') {
      if (!vault) {
        setStatusMessage('Open a vault before using a template.');
        return;
      }
      const root = vault.path;
      void Promise.all(
        allEntries
          .filter((entry) => entry.kind === 'note' && entry.path.startsWith('Templates/'))
          .map(async (entry) => ({
            id: `user:${entry.path}`,
            name: entry.name.replace(/\.md$/i, ''),
            content: await window.a11yNotebook!.vault.readNote(entry.path),
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
    if (commandId === 'open-vault') {
      if (
        assetDirty ||
        assetBusy ||
        openNotes.some((note) => note.content !== note.saved) ||
        activeConflict ||
        switchingRef.current
      ) {
        setStatusMessage('Save or resolve unsaved changes before opening another vault.');
        return;
      }
      switchingRef.current = true;
      vaultGenerationRef.current += 1;
      setSwitchingVault(true);
      void window.a11yNotebook?.vault
        .open()
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
            setSelectedTab('welcome');
            setStatusMessage(`Opened vault ${opened.name}.`);
          }
        })
        .catch(() => setStatusMessage('Could not open the selected vault.'))
        .finally(() => {
          switchingRef.current = false;
          setSwitchingVault(false);
        });
      if (!window.a11yNotebook) {
        switchingRef.current = false;
        setSwitchingVault(false);
      }
      return;
    }
    if (commandId === 'new-notebook') {
      if (!vault || !window.a11yNotebook) {
        setStatusMessage('Open a vault before creating a notebook.');
        return;
      }
      setItemDialog({ action: 'new-notebook' });
      return;
    }
    if (commandId === 'refresh-links') {
      void refreshVault().then(refreshLinkIndex);
      setStatusMessage('Vault and links refreshed.');
      return;
    }
    if (commandId === 'close-current-tab') {
      if (selectedTab === 'assets') {
        if (assetBusy) {
          setStatusMessage('Wait for the cognitive asset operation to finish.');
          return;
        }
        if (assetDirty && !window.confirm('Discard unsaved cognitive asset changes?')) return;
        setAssetTabOpen(false);
        setAssetDirty(false);
        setAssetBusy(false);
        setAssetInitialPath(undefined);
        setSelectedTab('welcome');
        return;
      }
      if (selectedTab === 'attachment') {
        setAttachment(null);
        setSelectedTab('welcome');
        return;
      }
      if (selectedTab === 'reminders') {
        setReminderTabOpen(false);
        setSelectedTab('welcome');
        return;
      }
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
      setMode: (nextMode) => {
        if (nextMode === 'edit' && currentNoteEditLocked) {
          setStatusMessage('Save this note before editing it again.');
          return;
        }
        setMode(nextMode);
      },
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
    if (activeDialog || itemDialog || activeConflict || document.querySelector('[role="dialog"]')) {
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
    if (event.defaultPrevented || event.isComposing) return;
    const command = COMMANDS.find((item) => {
      const shortcut = settings.shortcuts[item.id] ?? item.shortcut;
      return shortcut && matchesShortcut(event, shortcut);
    });
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
      if (isMenuCommand(command) && !document.querySelector('[role="dialog"]')) {
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
        <button
          type="button"
          disabled={!vault || openNotes.some((note) => note.content !== note.saved)}
          onClick={() => setActiveDialog('web-capture')}
        >
          Capture webpage
        </button>
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
                    aria-keyshortcuts={
                      (settings.shortcuts[command.id] ?? command.shortcut)
                        ? toAriaKeyShortcut(settings.shortcuts[command.id] ?? command.shortcut!)
                        : undefined
                    }
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
              onOpen={(entry) =>
                void openEntry(entry).catch(() => setStatusMessage('Could not open the selected file.'))
              }
              onRename={renameEntry}
              onDelete={(entryPath) => void deleteEntry(entryPath)}
              onAction={handleTreeAction}
            />
          ) : (
            <p>Open a folder as a local vault from the Vault menu.</p>
          )}
          {vault ? (
            <SearchResults
              filters={searchFilters}
              onFilters={setSearchFilters}
              notebooks={notebooks}
              results={searchResults}
              active={Boolean(searchText.trim() || Object.values(searchFilters).some(Boolean))}
              onOpen={(relative) => {
                const entry = findEntry(vault.entries, relative);
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
                    id={`tab-${tab.id}`}
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
                        if (tab.id === 'assets') {
                          if (assetBusy) {
                            setStatusMessage('Wait for the cognitive asset operation to finish.');
                            return;
                          }
                          if (assetDirty && !window.confirm('Discard unsaved cognitive asset changes?')) return;
                          setAssetTabOpen(false);
                          setAssetDirty(false);
                          setAssetBusy(false);
                          setAssetInitialPath(undefined);
                          if (selected) setSelectedTab('welcome');
                          return;
                        }
                        if (tab.id === 'reminders') {
                          setReminderTabOpen(false);
                          if (selected) setSelectedTab('welcome');
                          return;
                        }
                        if (tab.id === 'attachment') {
                          setAttachment(null);
                          if (selected) setSelectedTab('welcome');
                          return;
                        }
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
            aria-labelledby={`tab-${selectedTab}`}
            tabIndex={0}
          >
            {assetTabOpen ? (
              <div hidden={selectedTab !== 'assets'}>
                <AssetsWorkspace
                  paths={allEntries.filter((entry) => entry.kind !== 'notebook').map((entry) => entry.path)}
                  initialPath={assetInitialPath}
                  selectionVersion={assetSelectionVersion}
                  refresh={refreshVault}
                  announce={setStatusMessage}
                  onDirty={setAssetDirty}
                  onBusy={setAssetBusy}
                />
              </div>
            ) : null}
            {selectedTab === 'assets' ? null : selectedTab === 'reminders' ? (
              <RemindersView
                reminders={reminderState.reminders}
                notePaths={notePaths}
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
              />
            ) : selectedTab === 'attachment' && attachment ? (
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
              />
            ) : selectedTab === 'tasks' ? (
              <section aria-labelledby="tasks-heading">
                <h2 id="tasks-heading">Tasks</h2>
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
                          entry: { name: currentNote.title, path: currentNote.path, kind: 'note' },
                        });
                      }}
                    >
                      Encrypt note
                    </button>
                  )
                ) : null}
                {mode === 'edit' ? (
                  <button type="button" onClick={() => void saveActiveNote()}>
                    Save note
                  </button>
                ) : null}
                {currentNoteEditLocked && currentNote.content !== currentNote.saved ? (
                  <button type="button" onClick={() => void saveActiveNote()}>
                    Save locked note changes
                  </button>
                ) : null}
                {mode === 'edit' ? (
                  <EditorTools
                    ref={editorToolsRef}
                    textareaRef={editorRef}
                    bindShortcuts={false}
                    notePaths={notePaths}
                    announce={setStatusMessage}
                    onRequestAttachment={() => handleCommand('insert-attachment')}
                    onContentChange={(content) => updateNoteContent(currentNote.id, content)}
                  />
                ) : (
                  annotationTools.toolbar
                )}
                <div ref={annotationTools.documentRef}>
                  <MarkdownDocument
                    disabled={switchingVault}
                    notePath={currentNote.path}
                    editorRef={editorRef}
                    content={currentNote.content}
                    mode={mode}
                    links={links.filter((link) => link.sourcePath === currentNote.path)}
                    onChange={(content) => updateNoteContent(currentNote.id, content)}
                    onNavigate={(href) => void openLinkTarget(href)}
                  />
                </div>
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

      {activeDialog === 'palette' ? (
        <CommandPalette shortcuts={settings.shortcuts} onRun={handleCommand} onClose={closeDialog} />
      ) : null}
      {activeDialog === 'shortcuts' ? (
        <KeyboardShortcutsDialog shortcuts={settings.shortcuts} onClose={closeDialog} />
      ) : null}
      {activeDialog === 'about' ? <AboutDialog onClose={closeDialog} /> : null}
      {activeDialog === 'settings' ? (
        <SettingsDialog
          settings={settings}
          securityEnabled={securityEnabled}
          onClose={closeDialog}
          onSave={async (value) => {
            await window.a11yNotebook!.vault.saveSettings(value);
            setSettings(value);
            setStatusMessage('Settings saved.');
          }}
          onSetVaultPassword={async (password) => {
            const setupPassword = window.a11yNotebook?.vault.setupVaultPassword;
            if (!setupPassword) throw new Error('Vault security is unavailable.');
            await setupPassword(password);
            setSecurityEnabled(true);
            setSecurityLocked(false);
            setStatusMessage('Vault password protection enabled.');
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
          onUnlock={async (password) => {
            const unlock = window.a11yNotebook?.vault.unlockVault;
            if (!unlock) throw new Error('Vault security is unavailable.');
            const opened = await unlock(password);
            setVault(opened);
            setSecurityLocked(false);
            setSecurityEnabled(true);
            setStatusMessage('Vault unlocked.');
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
          onCapture={async (url, notebookPath) => {
            if (openNotes.some((note) => note.content !== note.saved) || activeConflict) {
              throw new Error('Save or resolve note changes before capturing a page.');
            }
            const capture = window.a11yNotebook?.vault.captureWeb;
            if (!capture) throw new Error('Web capture is unavailable.');
            const updated = await capture(url, notebookPath);
            setVault(updated);
            setSelectedTab('welcome');
            setStatusMessage('Web page captured as a Markdown note.');
          }}
        />
      ) : null}
      {activeDialog === 'template' ? (
        <NewFromTemplateDialog
          notebooks={[
            { path: '', name: 'Vault root' },
            ...notebooks.map((relative) => ({ path: relative, name: relative })),
          ]}
          templates={userTemplates}
          onClose={closeDialog}
          onCreate={async (relative, content, cursor) => {
            setVault(await window.a11yNotebook!.vault.createNote(relative, content));
            await openEntry({ path: relative, name: relative.split('/').at(-1)!, kind: 'note' });
            setMode('edit');
            setStatusMessage('Note created from template.');
            window.setTimeout(() => {
              editorRef.current?.focus();
              editorRef.current?.setSelectionRange(cursor, cursor);
            }, 0);
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
      {switchingVault ? (
        <Modal
          title="Opening vault"
          titleId="opening-vault-title"
          onClose={() => setStatusMessage('Wait for the folder selection or vault initialization to finish.')}
        >
          <p>
            Choose a folder in the native dialog, or wait while it is opened. Editing is paused to protect your notes.
          </p>
        </Modal>
      ) : null}
      {!securityLocked && activeConflict && !itemDialog && !activeDialog ? (
        <ConflictDialog key={activeConflict.path} conflict={activeConflict} onResolve={resolveConflict} />
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
