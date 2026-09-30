import { useEffect, useRef } from 'react';
import { RELEASES_URL } from '../../shared/app-info';
import type { UpdaterStatus } from '../../shared/updater';
import Modal, { focusInitialElement } from './Modal';

type UpdateDialogProps = {
  status: UpdaterStatus;
  announcement: string;
  currentVersion: string;
  onDownload: () => void;
  onInstallNow: () => void;
  onInstallOnExit: () => void;
  onRetry: () => void;
  onClose: () => void;
};

const MESSAGE_ID = 'update-dialog-message';

export default function UpdateDialog({
  status,
  announcement,
  currentVersion,
  onDownload,
  onInstallNow,
  onInstallOnExit,
  onRetry,
  onClose,
}: UpdateDialogProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const phase = status.state;

  // When the dialog changes phase its buttons change too, so move focus to the new
  // primary action instead of letting focus fall back to the document body.
  const previousPhase = useRef(phase);
  useEffect(() => {
    if (previousPhase.current !== phase && bodyRef.current) {
      const dialog = bodyRef.current.closest<HTMLElement>('[role="dialog"]');
      if (dialog) {
        focusInitialElement(dialog);
      }
    }
    previousPhase.current = phase;
  }, [phase]);

  let message: string;
  let details: JSX.Element | null = null;
  let actions: JSX.Element;

  switch (status.state) {
    case 'idle':
    case 'checking':
      message = 'Checking GitHub for a newer version of A11y Notebook…';
      actions = (
        <button type="button" data-autofocus onClick={onClose}>
          Close
        </button>
      );
      break;
    case 'update-available':
      message = `Version ${status.version} is available. You are using version ${currentVersion}.`;
      details = status.releaseNotes ? (
        <div className="release-notes">
          <h3>What’s new{status.releaseName ? ` in ${status.releaseName}` : ''}</h3>
          <p>{status.releaseNotes}</p>
        </div>
      ) : null;
      actions = (
        <>
          <button type="button" data-autofocus onClick={onDownload}>
            Download
          </button>
          <button type="button" onClick={onClose}>
            Not now
          </button>
        </>
      );
      break;
    case 'download-progress':
      message =
        'Downloading the update. You can hide this dialog and keep working; progress is shown in the status bar.';
      details = (
        <div className="progress">
          <span id="update-progress-label">Download progress</span>
          <div
            className="progress-track"
            role="progressbar"
            aria-labelledby="update-progress-label"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={status.percent}
            aria-valuetext={`${status.percent} percent`}
          >
            <div className="progress-fill" style={{ width: `${status.percent}%` }} />
          </div>
          <span aria-hidden="true">{status.percent}%</span>
        </div>
      );
      actions = (
        <button type="button" data-autofocus onClick={onClose}>
          Hide
        </button>
      );
      break;
    case 'update-downloaded':
      message = `Version ${status.version} has been downloaded. Restart now to install it, or install it automatically when you exit.`;
      actions = (
        <>
          <button type="button" data-autofocus onClick={onInstallNow}>
            Restart and install
          </button>
          <button type="button" onClick={onInstallOnExit}>
            Install on exit
          </button>
        </>
      );
      break;
    case 'update-not-available':
      message = `You are using the latest version of A11y Notebook (${status.version}).`;
      actions = (
        <button type="button" data-autofocus onClick={onClose}>
          Close
        </button>
      );
      break;
    case 'unsupported':
      message = status.message;
      details = (
        <p>
          Installers are published on the{' '}
          <a href={RELEASES_URL} target="_blank" rel="noreferrer">
            A11y Notebook releases page
          </a>
          .
        </p>
      );
      actions = (
        <button type="button" data-autofocus onClick={onClose}>
          Close
        </button>
      );
      break;
    case 'error':
      message = 'The update could not be completed.';
      details = (
        <p className="error-message" role="alert">
          {status.message}
        </p>
      );
      actions = (
        <>
          <button type="button" data-autofocus onClick={onRetry}>
            Try again
          </button>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </>
      );
      break;
  }

  return (
    <Modal titleId="update-dialog-title" title="Software update" describedBy={MESSAGE_ID} onClose={onClose}>
      <div ref={bodyRef} className="modal-body">
        <p id={MESSAGE_ID}>{message}</p>
        {details}
        {/* Errors are announced by the alert above; avoid a duplicate polite announcement. */}
        <p className="sr-only" role="status" aria-live="polite">
          {status.state === 'error' ? '' : announcement}
        </p>
      </div>
      <div className="modal-actions">{actions}</div>
    </Modal>
  );
}
