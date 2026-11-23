// "OCR this file" dialog: pick a language, run whole-file OCR with
// progress and cancel, then choose what happens to the result.
//
// The per-use choice (Q4): the recognized text is temporary in the
// reader by default. This dialog offers "Save into file" now, or "Keep
// temporary in reader" — and Ctrl+S in the reader saves it later. The
// language is asked every time: no option is preselected, and the Start
// button stays disabled until one is picked.
import { useEffect, useId, useRef, useState } from 'react';
import Modal from '../../components/Modal';
import {
  OCR_LANGUAGES,
  type OcrLanguageStatus,
  type OcrPageResult,
  type OcrProgress,
} from '../../../shared/ocr';
import { createTesseractEngine, type OcrEngine, type OcrEngineLogger } from './ocr-engine';
import { runOcrUnits, type OcrRunUnit } from './ocr-runner';

type Phase = 'pick' | 'preparing' | 'running' | 'done' | 'cancelled' | 'error';

interface OcrDialogProps {
  kind: '.pdf' | '.epub';
  /** Units with no extractable text — the ones the run will read. */
  total: number;
  /** True for an Alius: saving creates a copy and never touches the original. */
  isAlius: boolean;
  onClose: () => void;
  /** The run finished: hand the results to the reader for temporary display. */
  onComplete: (results: Map<number, OcrPageResult>) => void;
  /** Save the results into the file now (the dialog's Save button). */
  onSaveNow: () => Promise<void>;
  /**
   * Build the units to recognize. PDF pages render lazily, one at a time
   * inside the run; ePub images are extracted here.
   */
  prepareUnits: () => Promise<OcrRunUnit[]>;
  /** Engine factory; defaults to the real on-device Tesseract engine. Tests pass a fake. */
  createEngine?: (language: string, onLogger: OcrEngineLogger) => Promise<OcrEngine>;
}

/** Plain-language status for the engine's loading steps. */
function engineStatusText(status: string): string {
  if (status === 'loading tesseract core') return 'Loading the on-device OCR engine.';
  if (status === 'initializing tesseract') return 'Starting the on-device OCR engine.';
  if (status === 'loading language traineddata') return 'Loading language data.';
  return 'Preparing OCR.';
}

export default function OcrDialog({
  kind,
  total,
  isAlius,
  onClose,
  onComplete,
  onSaveNow,
  prepareUnits,
  createEngine,
}: OcrDialogProps) {
  const id = useId();
  const [phase, setPhase] = useState<Phase>('pick');
  const [language, setLanguage] = useState('');
  const [languages, setLanguages] = useState<OcrLanguageStatus[] | null>(null);
  const [progress, setProgress] = useState<OcrProgress>({
    phase: 'preparing',
    done: 0,
    total,
    pageProgress: 0,
    status: '',
  });
  const [error, setError] = useState('');
  const [saveBusy, setSaveBusy] = useState(false);
  const [recognizedCount, setRecognizedCount] = useState(0);
  const cancelledRef = useRef(false);
  const cancelResolveRef = useRef<(() => void) | null>(null);
  const engineRef = useRef<OcrEngine | null>(null);
  const mountedRef = useRef(true);
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);
  const busy = phase === 'preparing' || phase === 'running';

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      void engineRef.current?.terminate().catch(() => undefined);
    };
  }, []);

  // Which languages are ready, and which need a one-time download.
  useEffect(() => {
    let cancelled = false;
    const fallback: OcrLanguageStatus[] = OCR_LANGUAGES.map((entry) => ({
      ...entry,
      ready: entry.code === 'eng',
    }));
    const vault = window.a11yNotebook?.vault;
    if (!vault?.listOcrLanguages) {
      setLanguages(fallback);
      return;
    }
    void vault
      .listOcrLanguages()
      .then((listed) => {
        if (!cancelled) setLanguages(listed);
      })
      .catch(() => {
        if (!cancelled) setLanguages(fallback);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // When a run starts, focus lands on Cancel: it is the control the user
  // needs while the run takes minutes.
  useEffect(() => {
    if (busy) cancelButtonRef.current?.focus();
  }, [busy]);

  const showCancelled = (): void => {
    setPhase('cancelled');
    setProgress((current) => ({ ...current, status: 'OCR cancelled. No text was saved.' }));
  };

  const cancel = (): void => {
    if (!busy) return;
    cancelledRef.current = true;
    setProgress((current) => ({ ...current, status: 'Cancelling OCR.' }));
    cancelResolveRef.current?.();
    void engineRef.current?.terminate().catch(() => undefined);
  };

  const start = async (): Promise<void> => {
    const chosen = languages?.find((entry) => entry.code === language);
    if (!chosen) return;
    cancelledRef.current = false;
    cancelResolveRef.current = null;
    setError('');
    setPhase('preparing');
    setProgress({
      phase: 'preparing',
      done: 0,
      total,
      pageProgress: 0,
      status: `Preparing OCR in ${chosen.name}.`,
    });
    // Awaited alongside the run: if Cancel resolves first, the run's
    // result is discarded instead of hanging on a terminated worker.
    let cancelPromiseResolve: () => void = () => undefined;
    const cancelPromise = new Promise<void>((resolve) => {
      cancelPromiseResolve = resolve;
    });
    cancelResolveRef.current = cancelPromiseResolve;
    try {
      const vault = window.a11yNotebook?.vault;
      if (!chosen.ready) {
        setProgress((current) => ({
          ...current,
          status: `Downloading ${chosen.name} language data. This download happens once; OCR works offline afterwards.`,
        }));
        if (!vault?.ensureOcrLanguage) {
          throw new Error(`The ${chosen.name} language data is not on this computer and cannot be downloaded.`);
        }
        await vault.ensureOcrLanguage(chosen.code);
      }
      if (cancelledRef.current) return showCancelled();
      setProgress((current) => ({ ...current, status: 'Loading the on-device OCR engine.' }));
      const create = createEngine ?? createTesseractEngine;
      const engine = await create(chosen.code, (message) => {
        if (!mountedRef.current || cancelledRef.current) return;
        if (message.status === 'recognizing text') {
          setPhase('running');
          setProgress((current) => ({ ...current, phase: 'recognizing', pageProgress: message.progress }));
        } else {
          setProgress((current) => ({ ...current, status: engineStatusText(message.status) }));
        }
      });
      engineRef.current = engine;
      if (cancelledRef.current) {
        await engine.terminate().catch(() => undefined);
        engineRef.current = null;
        return showCancelled();
      }
      setProgress((current) => ({ ...current, status: 'Preparing pages.' }));
      const units = await prepareUnits();
      if (cancelledRef.current) {
        await engine.terminate().catch(() => undefined);
        engineRef.current = null;
        return showCancelled();
      }
      setPhase('running');
      const outcome = await Promise.race([
        runOcrUnits({
          engine,
          units,
          total,
          onProgress: (next) => {
            if (mountedRef.current && !cancelledRef.current) setProgress(next);
          },
          isCancelled: () => cancelledRef.current,
        }),
        cancelPromise.then(() => ({ cancelled: true, results: new Map<number, OcrPageResult>() })),
      ]);
      await engine.terminate().catch(() => undefined);
      engineRef.current = null;
      if (!mountedRef.current) return;
      if (outcome.cancelled) return showCancelled();
      const recognized = [...outcome.results.values()].filter((result) => result.text.trim()).length;
      setRecognizedCount(recognized);
      setPhase('done');
      setProgress({
        phase: 'recognizing',
        done: total,
        total,
        pageProgress: 1,
        status: `OCR finished. Recognized text for ${recognized} of ${total}.`,
      });
      onComplete(outcome.results);
    } catch (reason) {
      await engineRef.current?.terminate().catch(() => undefined);
      engineRef.current = null;
      if (!mountedRef.current) return;
      if (cancelledRef.current) return showCancelled();
      setError(reason instanceof Error ? reason.message : 'OCR could not run.');
      setPhase('error');
    }
  };

  const saveNow = async (): Promise<void> => {
    setSaveBusy(true);
    try {
      await onSaveNow();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The OCR text could not be saved.');
      setSaveBusy(false);
    }
  };

  const chosen = languages?.find((entry) => entry.code === language);
  const overall = total > 0 ? Math.round(((progress.done + progress.pageProgress) / total) * 100) : 0;
  const unitLabel = kind === '.pdf' ? 'page' : 'section';
  const unitPlural = kind === '.pdf' ? 'pages' : 'sections';

  return (
    <Modal
      titleId={`${id}-title`}
      title="OCR this file"
      describedBy={phase === 'pick' ? `${id}-intro` : undefined}
      onClose={busy ? cancel : onClose}
    >
      {phase === 'pick' ? (
        <>
          <p id={`${id}-intro`}>
            OCR runs entirely on this computer. Nothing is uploaded. It reads the whole file — {total}{' '}
            {total === 1 ? unitLabel : unitPlural} {total === 1 ? 'has' : 'have'} no extractable text — and can take a
            few minutes for a long file.
          </p>
          <fieldset>
            <legend>OCR language</legend>
            {!languages ? (
              <p>Loading languages…</p>
            ) : (
              languages.map((entry) => (
                <label key={entry.code}>
                  <input
                    type="radio"
                    name={`${id}-language`}
                    value={entry.code}
                    checked={language === entry.code}
                    onChange={() => setLanguage(entry.code)}
                  />
                  {entry.name}
                  {entry.ready ? '' : ' — language data will be downloaded once'}
                </label>
              ))
            )}
          </fieldset>
          {chosen && !chosen.ready ? (
            <p>
              {chosen.name} language data is not on this computer yet. It will be downloaded once when you start,
              then OCR works offline.
            </p>
          ) : null}
          <div>
            <button type="button" data-autofocus disabled={!language || !languages} onClick={() => void start()}>
              Start OCR
            </button>{' '}
            <button type="button" onClick={onClose}>
              Close
            </button>
          </div>
        </>
      ) : null}
      {busy ? (
        <>
          <div
            role="progressbar"
            aria-label="OCR progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={phase === 'running' ? overall : 0}
          >
            {phase === 'running' ? `${overall}%` : 'Starting…'}
          </div>
          <p role="status">{progress.status}</p>
          <button ref={cancelButtonRef} type="button" onClick={cancel}>
            Cancel OCR
          </button>
        </>
      ) : null}
      {phase === 'done' ? (
        <>
          <p role="status">
            OCR finished. Recognized text for {recognizedCount} of {total} {total === 1 ? unitLabel : unitPlural}. The
            text is shown in the reader for now.
          </p>
          <p>
            {isAlius
              ? 'Saving creates a copy in the library. The original file is not changed.'
              : 'Saving writes the recognized text into this file.'}{' '}
            You can also press Ctrl+S while the temporary text is shown to save it.
          </p>
          <div>
            <button type="button" disabled={saveBusy} onClick={() => void saveNow()}>
              {saveBusy ? 'Saving…' : 'Save into file'}
            </button>{' '}
            <button type="button" data-default disabled={saveBusy} onClick={onClose}>
              Keep temporary in reader
            </button>
          </div>
          {error ? <p role="alert">{error}</p> : null}
        </>
      ) : null}
      {phase === 'cancelled' ? (
        <>
          <p role="status">OCR cancelled. No text was saved.</p>
          <button type="button" data-default onClick={onClose}>
            Close
          </button>
        </>
      ) : null}
      {phase === 'error' ? (
        <>
          <p role="alert">{error || 'OCR could not run.'}</p>
          <div>
            <button
              type="button"
              data-default
              onClick={() => {
                setError('');
                setPhase('pick');
              }}
            >
              Try again
            </button>{' '}
            <button type="button" onClick={onClose}>
              Close
            </button>
          </div>
        </>
      ) : null}
    </Modal>
  );
}
