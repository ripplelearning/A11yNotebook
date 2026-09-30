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
  const latestStatus = useRef<UpdaterStatus>(status);

  const applyStatus = useCallback((next: UpdaterStatus) => {
    latestStatus.current = next;
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

  /**
   * Runs an updater action and resolves to true when it succeeded. Status events are
   * delivered before the invoke reply, so an error reported by the main process during
   * the call is already visible when the promise settles.
   */
  const run = useCallback(
    async (action: (() => Promise<void>) | undefined): Promise<boolean> => {
      if (!action) {
        applyStatus({ state: 'unsupported', message: UPDATES_DEV_BUILD_MESSAGE });
        return false;
      }
      const before = latestStatus.current;
      try {
        await action();
      } catch (error: unknown) {
        // Keep a readable error the main process already sent instead of replacing it
        // with the generic IPC rejection text.
        if (latestStatus.current === before || latestStatus.current.state !== 'error') {
          applyStatus({ state: 'error', message: formatUpdaterError(error) });
        }
        return false;
      }
      return !(latestStatus.current !== before && latestStatus.current.state === 'error');
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
    void run(bridge?.check);
  }, [bridge, status.state, applyStatus, run]);

  return {
    status,
    announcement,
    isAvailable: Boolean(bridge),
    check,
    download: useCallback(() => void run(bridge?.download), [bridge, run]),
    installNow: useCallback(() => void run(bridge?.installNow), [bridge, run]),
    /** Resolves to true once the main process has accepted "install on exit". */
    installOnExit: useCallback(() => run(bridge?.installOnExit), [bridge, run]),
  };
}
