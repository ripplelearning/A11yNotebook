import Modal from '../../components/Modal';

export default function DeleteLibraryDialog({
  library,
  permanent = false,
  onCancel,
  onConfirm,
}: {
  library: { name: string; path: string };
  /** Shift+Delete: the folder is removed for good, not moved to the Recycle Bin. */
  permanent?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal title="Delete library" titleId="delete-library-title" onClose={onCancel}>
      <p>
        {permanent ? (
          <>
            Permanently deleting this library will delete everything inside {library.name}, including notebooks,
            notes, files, tasks, and reminders. This cannot be undone and does not go to the Recycle Bin.
          </>
        ) : (
          <>
            Deleting this library will delete everything inside {library.name}, including notebooks, notes, files,
            tasks, and reminders. The library folder is moved to the Recycle Bin.
          </>
        )}
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
