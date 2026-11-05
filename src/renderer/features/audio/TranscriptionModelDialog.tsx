import { useState } from 'react';
import Modal from '../../components/Modal';
import {
  DEFAULT_TRANSCRIPTION_MODEL_ID,
  TRANSCRIPTION_MODELS,
  type TranscriptionModelOption,
} from '../../../shared/audio';

interface TranscriptionModelDialogProps {
  onDownload: (optionId: TranscriptionModelOption['id']) => void;
  onCancel: () => void;
}

/**
 * First-use transcription choice: the smaller or the larger Whisper
 * model. Both are free, both download once and then run on the
 * machine, and both keep audio local. The radio group states each
 * model's size and the key difference, so the choice is made on
 * facts, not on a model name alone. Download is first and default.
 */
export function TranscriptionModelDialog({ onDownload, onCancel }: TranscriptionModelDialogProps) {
  const [selected, setSelected] = useState<TranscriptionModelOption['id']>(
    DEFAULT_TRANSCRIPTION_MODEL_ID,
  );
  return (
    <Modal title="Choose a transcription model" titleId="transcription-model-title" onClose={onCancel}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onDownload(selected);
        }}
      >
        <p>
          Transcription runs on your machine, so your audio never leaves it. The model downloads
          once and is kept for later transcriptions. You can change the model later in Settings.
        </p>
        <fieldset>
          <legend>Transcription model</legend>
          {TRANSCRIPTION_MODELS.map((option) => (
            <label key={option.id}>
              <input
                type="radio"
                name="transcription-model"
                value={option.id}
                checked={selected === option.id}
                onChange={() => setSelected(option.id)}
              />
              {option.label} — {option.size}. {option.summary}
            </label>
          ))}
        </fieldset>
        <button type="submit" data-default>
          Download model
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </form>
    </Modal>
  );
}
