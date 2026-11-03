import { useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import Modal from '../../components/Modal';
import GlobalContextMenu from '../../components/GlobalContextMenu';
import VaultTree from './VaultTree';
import ItemDialog from './ItemDialog';
import ItemPropertiesDialog from './ItemPropertiesDialog';
import ProtectedItemDialog, { type ProtectedAction } from './ProtectedItemDialog';
import type { CommandDefinition, CommandId } from '../../../shared/command-registry';
import type { VaultBookmark, VaultEntry, VaultInfo, VaultLink, VaultTask } from '../../../shared/types';
import type { Reminder } from '../../../shared/reminders';
import {
  baseName,
  cloneEntries,
  copyNode,
  deleteNode,
  draftPathToLivePath,
  findEntryInTree,
  findProtectionBlockInTree,
  flattenEntries,
  nonCollidingCopyName,
  parentPath,
  previousNextNotebook,
  relocateNode,
  setProtectedFlag,
  validateStageDelete,
  validateStageRelocate,
  type StagedOp,
} from './organize-library';

interface Props {
  /** Live entries at the moment the dialog opened; the draft starts as a copy. */
  initialEntries: VaultEntry[];
  /** Current live entries, for the properties dialog. */
  liveEntries: VaultEntry[];
  tasks: VaultTask[];
  bookmarks: VaultBookmark[];
  reminders: Reminder[];
  links: VaultLink[];
  /** True when the item itself or anything inside it has unsaved note changes. */
  hasUnsavedChanges: (path: string) => boolean;
  /** True when any open note has unsaved changes. */
  anyUnsavedChanges: () => boolean;
  onClose: () => void;
  onOpenEntry: (entry: VaultEntry) => void;
  onApplied: (ops: StagedOp[], finalVault: VaultInfo) => void;
  onPartiallyApplied: (appliedOps: StagedOp[], finalVault: VaultInfo) => void;
  onVaultUpdated: (vault: VaultInfo) => void;
}

interface ProtectedRequest {
  targetPath: string;
  targetName: string;
  blockingPath: string;
  blockingName: string;
  blockingIsTarget: boolean;
  action: ProtectedAction;
}

interface ContextMenuState {
  x: number;
  y: number;
  invoker: HTMLElement;
  path: string;
}

/**
 * The library tree, moved out of the main view. Every change made here is
 * staged in a draft copy of the tree: OK replays the staged operations
 * through the existing rename, move, delete, copy, and protection
 * operations, and Cancel discards them all. Protected items refuse staged
 * changes with the protected dialog, exactly like the main view.
 */
export default function OrganizeLibraryDialog({
  initialEntries,
  liveEntries,
  tasks,
  bookmarks,
  reminders,
  links,
  hasUnsavedChanges,
  anyUnsavedChanges,
  onClose,
  onOpenEntry,
  onApplied,
  onPartiallyApplied,
  onVaultUpdated,
}: Props) {
  const [draft, setDraft] = useState<VaultEntry[]>(() => cloneEntries(initialEntries));
  const [staged, setStaged] = useState<StagedOp[]>([]);
  const [selection, setSelection] = useState<string | null>(null);
  const [clipboard, setClipboard] = useState<{ mode: 'cut' | 'copy'; path: string } | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [renameRequest, setRenameRequest] = useState<{ path: string } | null>(null);
  const [moveRequest, setMoveRequest] = useState<{ path: string } | null>(null);
  const [propertiesPath, setPropertiesPath] = useState<string | null>(null);
  const [protectedRequest, setProtectedRequest] = useState<ProtectedRequest | null>(null);
  const [status, setStatus] = useState('No staged changes.');
  const [commitError, setCommitError] = useState('');
  const [committing, setCommitting] = useState(false);

  const draftRef = useRef(draft);
  const stagedRef = useRef(staged);
  const pendingActionRef = useRef<(() => void) | null>(null);
  const progressRef = useRef(0);
  const commitPausedRef = useRef(false);
  const lastVaultRef = useRef<VaultInfo | null>(null);

  const setDraftList = (next: VaultEntry[]) => {
    draftRef.current = next;
    setDraft(next);
  };
  const setStagedList = (next: StagedOp[]) => {
    stagedRef.current = next;
    setStaged(next);
  };

  const openProtected = (request: {
    targetPath: string;
    targetName: string;
    block: { path: string; name: string };
    action: ProtectedAction;
    pending: () => void;
  }) => {
    pendingActionRef.current = request.pending;
    setProtectedRequest({
      targetPath: request.targetPath,
      targetName: request.targetName,
      blockingPath: request.block.path,
      blockingName: request.block.name,
      blockingIsTarget: request.block.path === request.targetPath,
      action: request.action,
    });
  };

  const handleUnprotect = async () => {
    if (!protectedRequest) return;
    const bridge = window.a11yNotebook?.vault;
    if (!bridge?.setProtection) throw new Error('Protection is unavailable.');
    const updated = await bridge.setProtection(protectedRequest.blockingPath, false);
    onVaultUpdated(updated);
    // The user's Unprotect choice overrides any staged protection for the
    // same item that has not been applied yet; applied ones sit behind
    // the commit progress and are never replayed.
    setDraftList(setProtectedFlag(draftRef.current, protectedRequest.blockingPath, false));
    setStagedList(
      stagedRef.current.filter(
        (op, index) =>
          !(op.type === 'protect' && op.path === protectedRequest.blockingPath && index >= progressRef.current),
      ),
    );
    const pending = pendingActionRef.current;
    pendingActionRef.current = null;
    commitPausedRef.current = false;
    setProtectedRequest(null);
    pending?.();
  };

  const abortCommit = (errorMessage?: string) => {
    const ops = stagedRef.current;
    const applied = ops.slice(0, progressRef.current);
    const remaining = ops.slice(progressRef.current);
    setStagedList(remaining);
    progressRef.current = 0;
    commitPausedRef.current = false;
    setCommitting(false);
    if (errorMessage) setCommitError(errorMessage);
    if (applied.length > 0 && lastVaultRef.current) onPartiallyApplied(applied, lastVaultRef.current);
  };

  const handleProtectedCancel = () => {
    pendingActionRef.current = null;
    setProtectedRequest(null);
    if (commitPausedRef.current) {
      commitPausedRef.current = false;
      abortCommit();
    }
  };

  const runCommit = async (startIndex: number) => {
    const bridge = window.a11yNotebook?.vault;
    if (!bridge) {
      abortCommit('The library connection is unavailable.');
      return;
    }
    const ops = stagedRef.current;
    if (ops.slice(startIndex).some((op) => op.type === 'move' || op.type === 'rename') && anyUnsavedChanges()) {
      abortCommit('Save or resolve all unsaved notes before applying moves or renames.');
      return;
    }
    for (let index = startIndex; index < ops.length; index += 1) {
      const op = ops[index];
      if (op.type === 'delete' && hasUnsavedChanges(op.path)) {
        progressRef.current = index;
        abortCommit(`Save or discard unsaved changes in ${baseName(op.path)} before applying.`);
        return;
      }
      const blockTarget =
        op.type === 'rename' || op.type === 'move' ? op.from : op.type === 'delete' ? op.path : null;
      if (blockTarget) {
        const block = findProtectionBlockInTree(draftRef.current, blockTarget);
        if (block) {
          const entry = findEntryInTree(draftRef.current, blockTarget);
          pendingActionRef.current = () => void runCommit(index);
          commitPausedRef.current = true;
          setProtectedRequest({
            targetPath: blockTarget,
            targetName: entry?.name ?? baseName(blockTarget),
            blockingPath: block.path,
            blockingName: block.name,
            blockingIsTarget: block.path === blockTarget,
            action: op.type === 'rename' ? 'rename' : op.type === 'move' ? 'move' : op.type === 'delete' && op.permanent ? 'delete-permanent' : 'delete',
          });
          return;
        }
      }
      try {
        let updated: VaultInfo;
        if (op.type === 'rename') {
          updated = await bridge.rename(op.from, baseName(op.to));
          if (findEntryInTree(updated.entries, op.from)) {
            progressRef.current = index;
            abortCommit();
            return;
          }
        } else if (op.type === 'move') {
          updated = await bridge.move(op.from, op.to);
          if (findEntryInTree(updated.entries, op.from)) {
            progressRef.current = index;
            abortCommit();
            return;
          }
        } else if (op.type === 'delete') {
          updated = op.permanent
            ? await bridge.deletePermanently(op.path, hasUnsavedChanges(op.path))
            : await bridge.delete(op.path);
          if (findEntryInTree(updated.entries, op.path)) {
            progressRef.current = index;
            abortCommit();
            return;
          }
        } else if (op.type === 'copy') {
          if (!bridge.copyEntry) throw new Error('Copying is unavailable.');
          updated = await bridge.copyEntry(op.from, op.to);
        } else {
          if (!bridge.setProtection) throw new Error('Protection is unavailable.');
          updated = await bridge.setProtection(op.path, op.value);
        }
        lastVaultRef.current = updated;
        progressRef.current = index + 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Could not apply the staged changes.';
        if (/protected/i.test(message)) {
          // Protection changed outside the dialog: refresh, then offer
          // the protected dialog for the freshly found blocker.
          try {
            const fresh = await bridge.get();
            if (fresh) {
              onVaultUpdated(fresh);
              const freshBlock = blockTarget ? findProtectionBlockInTree(fresh.entries, blockTarget) : null;
              if (freshBlock && blockTarget) {
                const entry = findEntryInTree(draftRef.current, blockTarget);
                pendingActionRef.current = () => void runCommit(index);
                commitPausedRef.current = true;
                setProtectedRequest({
                  targetPath: blockTarget,
                  targetName: entry?.name ?? baseName(blockTarget),
                  blockingPath: freshBlock.path,
                  blockingName: freshBlock.name,
                  blockingIsTarget: freshBlock.path === blockTarget,
                  action:
                    op.type === 'rename'
                      ? 'rename'
                      : op.type === 'move'
                        ? 'move'
                        : op.type === 'delete' && op.permanent
                          ? 'delete-permanent'
                          : 'delete',
                });
                return;
              }
            }
          } catch {
            // Fall through to aborting with the original error.
          }
        }
        progressRef.current = index;
        abortCommit(message);
        return;
      }
    }
    const applied = stagedRef.current;
    progressRef.current = 0;
    commitPausedRef.current = false;
    setCommitting(false);
    if (lastVaultRef.current) onApplied(applied, lastVaultRef.current);
    onClose();
  };

  const handleOk = () => {
    if (committing) return;
    if (stagedRef.current.length === 0) {
      onClose();
      return;
    }
    setCommitError('');
    setStatus('Applying staged changes…');
    setCommitting(true);
    progressRef.current = 0;
    lastVaultRef.current = null;
    void runCommit(0);
  };

  const handleClose = () => {
    if (!committing) onClose();
  };

  const stageRelocate = (from: string, to: string, type: 'rename' | 'move') => {
    const check = validateStageRelocate(draftRef.current, from, to);
    if (check.kind === 'error') {
      setStatus(check.message);
      return;
    }
    if (check.kind === 'protected') {
      const target = findEntryInTree(draftRef.current, from);
      openProtected({
        targetPath: from,
        targetName: target?.name ?? baseName(from),
        block: check.block,
        action: type,
        pending: () => stageRelocate(from, to, type),
      });
      return;
    }
    setDraftList(relocateNode(draftRef.current, from, to));
    setStagedList([...stagedRef.current, { type, from, to }]);
    setStatus(`${type === 'rename' ? 'Renamed' : 'Moved'} ${baseName(from)} (staged). Press OK to apply.`);
  };

  const stageDelete = (path: string, permanent: boolean) => {
    const check = validateStageDelete(draftRef.current, path);
    if (check.kind === 'error') {
      setStatus(check.message);
      return;
    }
    if (check.kind === 'protected') {
      const target = findEntryInTree(draftRef.current, path);
      openProtected({
        targetPath: path,
        targetName: target?.name ?? baseName(path),
        block: check.block,
        action: permanent ? 'delete-permanent' : 'delete',
        pending: () => stageDelete(path, permanent),
      });
      return;
    }
    setDraftList(deleteNode(draftRef.current, path));
    setStagedList([...stagedRef.current, { type: 'delete', path, permanent }]);
    setStatus(`Staged ${permanent ? 'permanent ' : ''}delete of ${baseName(path)}. Press OK to apply.`);
  };

  const stageProtectToggle = (entry: VaultEntry) => {
    const value = !entry.protected;
    setDraftList(setProtectedFlag(draftRef.current, entry.path, value));
    setStagedList([...stagedRef.current, { type: 'protect', path: entry.path, value }]);
    setStatus(`${value ? 'Protected' : 'Unprotected'} ${entry.name} (staged). Press OK to apply.`);
  };

  const stagePaste = () => {
    if (!clipboard) {
      setStatus('Nothing to paste.');
      return;
    }
    const selected = selection ? findEntryInTree(draftRef.current, selection) : undefined;
    const target = selected ? (selected.kind === 'notebook' ? selected.path : parentPath(selected.path)) : '';
    if (clipboard.mode === 'cut') {
      const from = clipboard.path;
      const to = [target, baseName(from)].filter(Boolean).join('/');
      const check = validateStageRelocate(draftRef.current, from, to);
      if (check.kind === 'error') {
        setStatus(check.message);
        return;
      }
      if (check.kind === 'protected') {
        const targetEntry = findEntryInTree(draftRef.current, from);
        openProtected({
          targetPath: from,
          targetName: targetEntry?.name ?? baseName(from),
          block: check.block,
          action: 'move',
          pending: () => stagePaste(),
        });
        return;
      }
      setDraftList(relocateNode(draftRef.current, from, to));
      setStagedList([...stagedRef.current, { type: 'move', from, to }]);
      setClipboard(null);
      setStatus(`Moved ${baseName(from)} (staged). Press OK to apply.`);
    } else {
      const from = clipboard.path;
      const source = findEntryInTree(draftRef.current, from);
      if (!source) {
        setStatus('The copied item is no longer in the library.');
        return;
      }
      const name = nonCollidingCopyName(draftRef.current, target, source.name);
      const to = [target, name].filter(Boolean).join('/');
      setDraftList(copyNode(draftRef.current, from, to));
      setStagedList([...stagedRef.current, { type: 'copy', from, to }]);
      setStatus(`Copied ${source.name} as ${name} (staged). Press OK to apply.`);
    }
  };

  const moveToAdjacent = (entry: VaultEntry, direction: 'previous' | 'next') => {
    const { previous, next } = previousNextNotebook(draftRef.current, entry.path);
    const target = direction === 'previous' ? previous : next;
    if (!target) {
      setStatus(`No ${direction} notebook to move into.`);
      return;
    }
    stageRelocate(entry.path, [target.path, entry.name].filter(Boolean).join('/'), 'move');
  };

  const moveOut = (entry: VaultEntry) => {
    const parent = parentPath(entry.path);
    if (!parent) {
      setStatus('Already at the top level of the library.');
      return;
    }
    stageRelocate(entry.path, [parentPath(parent), entry.name].filter(Boolean).join('/'), 'move');
  };

  const handleOpen = (entry: VaultEntry) => {
    const livePath = draftPathToLivePath(entry.path, stagedRef.current);
    if (!livePath) {
      setStatus('Apply the staged changes first, then open this item.');
      return;
    }
    const liveEntry = findEntryInTree(liveEntries, livePath);
    if (!liveEntry) {
      setStatus('The selected item is no longer in the library.');
      return;
    }
    onOpenEntry(liveEntry);
    onClose();
  };

  const emailItem = async (entry: VaultEntry) => {
    if (entry.kind === 'notebook') {
      setStatus('A notebook cannot be attached. Choose a note or file.');
      return;
    }
    const livePath = draftPathToLivePath(entry.path, stagedRef.current);
    if (!livePath) {
      setStatus('Apply the staged changes first, then send this item by email.');
      return;
    }
    const bridge = window.a11yNotebook?.vault;
    if (!bridge?.emailItem) {
      setStatus('Sending by email is unavailable.');
      return;
    }
    try {
      await bridge.emailItem(livePath);
      setStatus(`Opened a new email with ${entry.name} attached.`);
    } catch {
      setStatus('Could not open the mail app.');
    }
  };

  const submitRename = async (name: string) => {
    if (!renameRequest) return;
    const to = [parentPath(renameRequest.path), name].filter(Boolean).join('/');
    const check = validateStageRelocate(draftRef.current, renameRequest.path, to);
    if (check.kind === 'error') throw new Error(check.message);
    if (check.kind === 'protected') {
      const target = findEntryInTree(draftRef.current, renameRequest.path);
      openProtected({
        targetPath: renameRequest.path,
        targetName: target?.name ?? baseName(renameRequest.path),
        block: check.block,
        action: 'rename',
        pending: () => stageRelocate(renameRequest.path, to, 'rename'),
      });
      return;
    }
    stageRelocate(renameRequest.path, to, 'rename');
  };

  const submitMove = async (name: string, notebook: string) => {
    if (!moveRequest) return;
    const to = [notebook, baseName(moveRequest.path)].filter(Boolean).join('/');
    const check = validateStageRelocate(draftRef.current, moveRequest.path, to);
    if (check.kind === 'error') throw new Error(check.message);
    if (check.kind === 'protected') {
      const target = findEntryInTree(draftRef.current, moveRequest.path);
      openProtected({
        targetPath: moveRequest.path,
        targetName: target?.name ?? baseName(moveRequest.path),
        block: check.block,
        action: 'move',
        pending: () => stageRelocate(moveRequest.path, to, 'move'),
      });
      return;
    }
    stageRelocate(moveRequest.path, to, 'move');
  };

  const selectedEntry = selection ? findEntryInTree(draft, selection) : undefined;
  const contextEntry = contextMenu ? findEntryInTree(draft, contextMenu.path) : undefined;
  const propertiesEntry = propertiesPath ? findEntryInTree(draft, propertiesPath) : undefined;
  const draftNotebooks = flattenEntries(draft)
    .filter((entry) => entry.kind === 'notebook')
    .map((entry) => entry.path);

  const menuItems = (entry: VaultEntry): CommandDefinition[] => [
    { id: 'context-open' as CommandId, label: 'Open', description: 'Open the selected item.', shortcut: 'Enter' },
    { id: 'context-rename' as CommandId, label: 'Rename', description: 'Rename the selected item.', shortcut: 'F2' },
    {
      id: 'context-move' as CommandId,
      label: 'Move to another notebook',
      description: 'Move the selected item to another notebook.',
    },
    {
      id: 'organize-move-previous' as CommandId,
      label: 'Move into previous notebook',
      description: 'Move the selected item into the previous notebook.',
      shortcut: 'Alt+Up',
    },
    {
      id: 'organize-move-next' as CommandId,
      label: 'Move into next notebook',
      description: 'Move the selected item into the next notebook.',
      shortcut: 'Alt+Down',
    },
    {
      id: 'organize-move-out' as CommandId,
      label: 'Move out one level',
      description: 'Move the selected item out of its current notebook.',
      shortcut: 'Alt+Shift+Up',
    },
    { id: 'organize-cut' as CommandId, label: 'Cut', description: 'Cut the selected item for pasting elsewhere.', shortcut: 'Ctrl+X' },
    { id: 'organize-copy' as CommandId, label: 'Copy', description: 'Copy the selected item for pasting elsewhere.', shortcut: 'Ctrl+C' },
    { id: 'organize-paste' as CommandId, label: 'Paste', description: 'Paste the cut or copied item here.', shortcut: 'Ctrl+V' },
    { id: 'context-delete' as CommandId, label: 'Delete', description: 'Delete the selected item.', shortcut: 'Delete' },
    {
      id: 'organize-delete-permanent' as CommandId,
      label: 'Delete permanently',
      description: 'Delete the selected item without keeping it in the trash.',
      shortcut: 'Shift+Delete',
    },
    {
      id: 'context-protect' as CommandId,
      label: entry.protected ? 'Unprotect' : 'Protect',
      description: 'Prevent renaming, moving, deleting, or editing this item until it is unprotected.',
    },
    { id: 'context-properties' as CommandId, label: 'Properties', description: 'Show details and counts for the selected item.' },
    ...(entry.kind === 'notebook'
      ? []
      : [
          {
            id: 'context-email-item' as CommandId,
            label: 'Send to email',
            description: 'Open a new email in the default mail app with this file attached.',
          },
        ]),
  ];

  const disabledMenuItems = (entry: VaultEntry): Set<CommandId> => {
    const disabled = new Set<CommandId>();
    const { previous, next } = previousNextNotebook(draft, entry.path);
    if (!previous) disabled.add('organize-move-previous' as CommandId);
    if (!next) disabled.add('organize-move-next' as CommandId);
    if (!parentPath(entry.path)) disabled.add('organize-move-out' as CommandId);
    if (!clipboard) disabled.add('organize-paste' as CommandId);
    return disabled;
  };

  const handleMenuCommand = (id: string, entry: VaultEntry) => {
    switch (id) {
      case 'context-open':
        handleOpen(entry);
        break;
      case 'context-rename':
        setRenameRequest({ path: entry.path });
        break;
      case 'context-move':
        setMoveRequest({ path: entry.path });
        break;
      case 'organize-move-previous':
        moveToAdjacent(entry, 'previous');
        break;
      case 'organize-move-next':
        moveToAdjacent(entry, 'next');
        break;
      case 'organize-move-out':
        moveOut(entry);
        break;
      case 'organize-cut':
        setClipboard({ mode: 'cut', path: entry.path });
        setStatus(`Cut ${entry.name}. Paste into a notebook to move it.`);
        break;
      case 'organize-copy':
        setClipboard({ mode: 'copy', path: entry.path });
        setStatus(`Copied ${entry.name}. Paste into a notebook to duplicate it.`);
        break;
      case 'organize-paste':
        stagePaste();
        break;
      case 'context-delete':
        stageDelete(entry.path, false);
        break;
      case 'organize-delete-permanent':
        stageDelete(entry.path, true);
        break;
      case 'context-protect':
        stageProtectToggle(entry);
        break;
      case 'context-properties':
        setPropertiesPath(entry.path);
        break;
      case 'context-email-item':
        void emailItem(entry);
        break;
      default:
        break;
    }
  };

  const onTreeContextMenu = (event: MouseEvent) => {
    const item = (event.target as HTMLElement).closest?.('[role="treeitem"]') as HTMLElement | null;
    if (!item) return;
    event.preventDefault();
    event.stopPropagation();
    item.focus();
    setContextMenu({ x: event.clientX, y: event.clientY, invoker: item, path: item.dataset.path ?? '' });
  };

  const onTreeKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter') {
      // VaultTree already opened the item; keep Modal's Enter-to-default
      // (OK) from firing on top of it.
      const item = (event.target as HTMLElement).closest?.('[role="treeitem"]');
      if (item) event.stopPropagation();
      return;
    }
    if ((event.shiftKey && event.key === 'F10') || event.key === 'ContextMenu') {
      const active = document.activeElement as HTMLElement | null;
      const item = active?.closest?.('[role="treeitem"]') as HTMLElement | null;
      if (!item) return;
      event.preventDefault();
      event.stopPropagation();
      const rect = item.getBoundingClientRect();
      setContextMenu({ x: rect.left, y: rect.bottom, invoker: item, path: item.dataset.path ?? '' });
    }
  };

  return (
    <Modal title="Organize Library" titleId="organize-library-title" className="wide-modal" onClose={handleClose}>
      <p>
        Arrange notebooks, notes, and files. Changes are staged: OK applies them and Cancel discards them. Alt+Up and
        Alt+Down move the selected item into the previous or next notebook; Alt+Shift+Up or Alt+Shift+Down moves it out
        one level. Cut, copy, and paste with Ctrl+X, Ctrl+C, and Ctrl+V. Enter opens the selected item and closes this
        dialog without applying staged changes.
      </p>
      <div onContextMenu={onTreeContextMenu} onKeyDown={onTreeKeyDown}>
        <VaultTree
          entries={draft}
          selectedPath={selectedEntry?.path ?? null}
          onSelect={(entry) => setSelection(entry.path)}
          onOpen={handleOpen}
          onRename={(path) => setRenameRequest({ path })}
          onDelete={(path) => stageDelete(path, false)}
          onDeletePermanent={(path) => stageDelete(path, true)}
          onMovePrevious={(entry) => moveToAdjacent(entry, 'previous')}
          onMoveNext={(entry) => moveToAdjacent(entry, 'next')}
          onMoveOut={(entry) => moveOut(entry)}
          onCut={(entry) => {
            setClipboard({ mode: 'cut', path: entry.path });
            setStatus(`Cut ${entry.name}. Paste into a notebook to move it.`);
          }}
          onCopy={(entry) => {
            setClipboard({ mode: 'copy', path: entry.path });
            setStatus(`Copied ${entry.name}. Paste into a notebook to duplicate it.`);
          }}
          onPaste={() => stagePaste()}
        />
      </div>
      {contextMenu && contextEntry ? (
        <GlobalContextMenu
          commands={menuItems(contextEntry)}
          label={`Actions for ${contextEntry.name}`}
          x={contextMenu.x}
          y={contextMenu.y}
          invoker={contextMenu.invoker}
          disabled={disabledMenuItems(contextEntry)}
          onClose={() => setContextMenu(null)}
          onSelect={(id) => {
            setContextMenu(null);
            handleMenuCommand(id as string, contextEntry);
          }}
        />
      ) : null}
      <p>
        {staged.length === 0 ? 'No staged changes.' : `${staged.length} staged change${staged.length === 1 ? '' : 's'}.`}
      </p>
      {commitError ? <p role="alert">{commitError}</p> : null}
      <p role="status">{status}</p>
      <button type="button" data-default disabled={committing} onClick={handleOk}>
        OK
      </button>{' '}
      <button type="button" disabled={committing} onClick={handleClose}>
        Cancel
      </button>
      {renameRequest ? (
        <ItemDialog
          request={{ action: 'rename', path: renameRequest.path }}
          notebooks={draftNotebooks}
          onSubmit={(name) => submitRename(name)}
          onClose={() => setRenameRequest(null)}
        />
      ) : null}
      {moveRequest ? (
        <ItemDialog
          request={{ action: 'move', path: moveRequest.path }}
          notebooks={draftNotebooks}
          onSubmit={(name, notebook) => submitMove(name, notebook)}
          onClose={() => setMoveRequest(null)}
        />
      ) : null}
      {propertiesPath && propertiesEntry ? (
        <ItemPropertiesDialog
          entry={propertiesEntry}
          livePath={draftPathToLivePath(propertiesPath, staged)}
          liveEntries={liveEntries}
          tasks={tasks}
          bookmarks={bookmarks}
          reminders={reminders}
          links={links}
          onClose={() => setPropertiesPath(null)}
        />
      ) : null}
      {protectedRequest ? (
        <ProtectedItemDialog
          itemName={protectedRequest.targetName}
          blockingName={protectedRequest.blockingName}
          blockingIsTarget={protectedRequest.blockingIsTarget}
          action={protectedRequest.action}
          onUnprotect={handleUnprotect}
          onCancel={handleProtectedCancel}
        />
      ) : null}
    </Modal>
  );
}
