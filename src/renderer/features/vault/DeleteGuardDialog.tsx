import Modal from '../../components/Modal';

/**
 * Confirmation shown before deleting a note or notebook that contains
 * tasks. Tasks are checklist lines inside notes, so deleting the note
 * deletes its tasks too — the guard names the count so the deletion is
 * never a surprise.
 */
export default function DeleteGuardDialog({
  name,
  kind,
  permanent = false,
  taskCount,
  onCancel,
  onConfirm,
}: {
  name: string;
  kind: 'note' | 'notebook';
  /** Shift+Delete: the item is removed for good, not moved to the Recycle Bin. */
  permanent?: boolean;
  taskCount: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const taskWord = taskCount === 1 ? 'task' : 'tasks';
  const item = kind === 'notebook' ? 'notebook' : 'note';
  return (
    <Modal title={`Delete ${item}`} titleId="delete-guard-title" onClose={onCancel}>
      <p>
        {kind === 'notebook'
          ? `This notebook “${name}” contains ${taskCount} ${taskWord} in its notes. Deleting the notebook will also delete them.`
          : `This note “${name}” contains ${taskCount} ${taskWord}. Deleting the note will also delete ${
              taskCount === 1 ? 'it' : 'them'
            }.`}{' '}
        {permanent
          ? 'This cannot be undone and does not go to the Recycle Bin.'
          : `The ${item} will be moved to the Recycle Bin.`}
      </p>
      <button data-autofocus type="button" onClick={onConfirm}>
        {permanent ? 'Delete permanently' : 'Delete'}
      </button>
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
    </Modal>
  );
}
