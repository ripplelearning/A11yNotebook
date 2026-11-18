import { useState } from 'react';
import Modal from '../../components/Modal';

interface Props {
  onSubmit: (source: string, alt: string) => void;
  onClose: () => void;
}

/**
 * Insert a picture that is already in the library into the note. The
 * native prompt the toolbar used to ask with does not work in this app
 * (Electron does not implement window.prompt), so the question is asked
 * here instead, in the app's own accessible dialog. The description is
 * required: a picture without one is stripped by the note sanitizer,
 * so an undescribed insert would silently vanish.
 */
export default function InsertImageDialog({ onSubmit, onClose }: Props) {
  const [source, setSource] = useState('');
  const [alt, setAlt] = useState('');
  const [error, setError] = useState('');
  return (
    <Modal title="Insert image" titleId="insert-image-dialog-title" onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!source.trim()) {
            setError('Enter the library image path.');
            return;
          }
          if (!alt.trim()) {
            setError('Enter an image description. Pictures need a description so screen readers can announce them.');
            return;
          }
          onSubmit(source.trim(), alt.trim());
        }}
      >
        <p>The path of a picture in the library, relative to this note — for example Dot.png.</p>
        <label>
          Library image path
          <input data-autofocus value={source} maxLength={500} onChange={(event) => setSource(event.target.value)} />
        </label>
        <label>
          Image description
          <input value={alt} maxLength={2000} onChange={(event) => setAlt(event.target.value)} />
        </label>
        {error ? <p role="alert">{error}</p> : null}
        <button type="submit" data-default>
          Insert
        </button>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
      </form>
    </Modal>
  );
}
