import Modal from '../../components/Modal';

interface DictationMicBlockedDialogProps {
  onRetry: () => void;
  onCancel: () => void;
}

/**
 * The microphone is blocked, so dictation cannot start. A status-line
 * message used to be the whole story: the user had no way to retry and
 * no way to find out how to allow the microphone, so a denied mic
 * stranded them. This dialog says what happened, how to allow the
 * microphone, and offers Retry — which tries the microphone again
 * without choosing the transcription model again — or Cancel.
 */
export function DictationMicBlockedDialog({ onRetry, onCancel }: DictationMicBlockedDialogProps) {
  return (
    <Modal
      role="alertdialog"
      title="Microphone is blocked"
      titleId="dictation-mic-blocked-title"
      describedBy="dictation-mic-blocked-description"
      onClose={onCancel}
    >
      <div id="dictation-mic-blocked-description">
        <p>A11y Notebook cannot use the microphone, so dictation cannot start.</p>
        <p>
          On Windows, open Settings → Privacy &amp; security → Microphone, turn on Microphone access and Let
          desktop apps access your microphone, then choose Retry.
        </p>
        <p>You do not need to choose the transcription model again.</p>
      </div>
      <button data-autofocus data-default type="button" onClick={onRetry}>
        Retry
      </button>
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
    </Modal>
  );
}
