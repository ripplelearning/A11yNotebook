import { useCallback, useEffect, useRef, useState } from 'react';
import {
  describeUpdaterStatus,
  formatUpdaterError,
  isUpdaterStatus,
  progressAnnouncementBucket,
  UPDATES_DEV_BUILD_MESSAGE,
  type UpdaterStatus,
} from '../../shared/updater';

/**
 * Tracks updater status from the main process and derives a screen-reader-friendly
 * announcement. Download progress is only announced in 10 percent steps.
 */
export function useUpdater() {
  const bridge = typeof window === 'undefined' ? undefined : window.a11yNotebook?.updater;
  const [status, setStatus] = useState<UpdaterStatus>({ state: 'idle' });
  const [announcement, setAnnouncement] = useState('');
  const lastAnnouncedBucket = useRef(-1);

  const applyStatus = useCallback((next: UpdaterStatus) => {
    setStatus(next);
    if (next.state === 'download-progress') {
      const bucket = progressAnnouncementBucket(next.percent);
      if (bucket > lastAnnouncedBucket.current) {
        lastAnnouncedBucket.current = bucket;
        setAnnouncement(describeUpdaterStatus({ state: 'download-progress', percent: bucket }));
      }
      return;
    }
    lastAnnouncedBucket.current = -1;
    setAnnouncement(describeUpdaterStatus(next));
  }, []);

  useEffect(() => {
    if (!bridge) {
      return undefined;
    }
    return bridge.onStatus((incoming) => {
      if (isUpdaterStatus(incoming)) {
        applyStatus(incoming);
      }
    });
  }, [bridge, applyStatus]);

  const run = useCallback(
    (action: (() => Promise<void>) | undefined) => {
      if (!action) {
        applyStatus({ state: 'unsupported', message: UPDATES_DEV_BUILD_MESSAGE });
        return;
      }
      action().catch((error: unknown) => applyStatus({ state: 'error', message: formatUpdaterError(error) }));
    },
    [applyStatus],
  );

  const check = useCallback(() => {
    // A download in progress or a finished download is shown as-is instead of re-checking.
    if (status.state === 'download-progress' || status.state === 'update-downloaded') {
      return;
    }
    if (bridge) {
      applyStatus({ state: 'checking' });
    }
    run(bridge?.check);
  }, [bridge, status.state, applyStatus, run]);

  return {
    status,
    announcement,
    isAvailable: Boolean(bridge),
    check,
    download: useCallback(() => run(bridge?.download), [bridge, run]),
    installNow: useCallback(() => run(bridge?.installNow), [bridge, run]),
    installOnExit: useCallback(() => run(bridge?.installOnExit), [bridge, run]),
  };
}
