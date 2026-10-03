import { useId, useState, type FormEvent } from 'react';
import Modal from './Modal';

interface NameDialogProps {
  title: string;
  label: string;
  initialValue?: string;
  submitLabel: string;
  onSubmit: (value: string) => void;
  onClose: () => void;
}

export default function NameDialog({
  title,
  label,
  initialValue = '',
  submitLabel,
  onSubmit,
  onClose,
}: NameDialogProps) {
  const id = useId();
  const [value, setValue] = useState(initialValue);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = value.trim();
    if (name) onSubmit(name);
  };

  return (
    <Modal titleId={`${id}-title`} title={title} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="modal-body">
          <label htmlFor={`${id}-name`}>{label}</label>
          <input id={`${id}-name`} data-autofocus value={value} onChange={(event) => setValue(event.target.value)} />
        </div>
        <div className="modal-actions">
          <button type="submit" disabled={!value.trim()}>
            {submitLabel}
          </button>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}
