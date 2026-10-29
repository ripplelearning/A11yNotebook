import Modal from '../../components/Modal';

export default function DeleteLibraryDialog({
  library,
  onCancel,
  onConfirm,
}: {
  library: { name: string; path: string };
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal title="Delete library" titleId="delete-library-title" onClose={onCancel}>
      <p>
        Deleting this library will delete everything inside {library.name}, including notebooks, notes, files,
        tasks, and reminders. The library folder is moved to the Recycle Bin.
      </p>
      <button data-autofocus type="button" onClick={onConfirm}>
        Delete
      </button>
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
    </Modal>
  );
}
