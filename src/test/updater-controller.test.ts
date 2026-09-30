// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createUpdaterController, type UpdaterEngine } from '../../electron/updater-controller';
import type { UpdaterStatus } from '../shared/updater';

function setup(options: { isPackaged?: boolean; isPortable?: boolean; engine?: Partial<UpdaterEngine> } = {}) {
  const statuses: UpdaterStatus[] = [];
  const engine: UpdaterEngine = {
    checkForUpdates: vi.fn(async () => undefined),
    downloadUpdate: vi.fn(async () => undefined),
    quitAndInstall: vi.fn(),
    setAutoInstallOnAppQuit: vi.fn(),
    ...options.engine,
  };
  const controller = createUpdaterController({
    isPackaged: options.isPackaged ?? true,
    isPortable: options.isPortable ?? false,
    currentVersion: '0.1.0',
    engine,
    send: (status) => statuses.push(status),
  });
  return { controller, engine, statuses };
}

describe('updater controller', () => {
  it('does not contact GitHub in development builds', async () => {
    const { controller, engine, statuses } = setup({ isPackaged: false });
    await controller.check();
    expect(engine.checkForUpdates).not.toHaveBeenCalled();
    expect(statuses).toEqual([{ state: 'unsupported', message: 'Updates are only available in the installed build.' }]);
  });

  it('does not attempt updates from the portable build', async () => {
    const { controller, engine, statuses } = setup({ isPortable: true });
    await controller.check();
    expect(engine.checkForUpdates).not.toHaveBeenCalled();
    expect(statuses[0].state).toBe('unsupported');
  });

  it('settles the check from the resolved result when no event was emitted', async () => {
    const available = setup({
      engine: { checkForUpdates: vi.fn(async () => ({ isUpdateAvailable: true, updateInfo: { version: '0.3.0' } })) },
    });
    await available.controller.check();
    expect(available.statuses.map((status) => status.state)).toEqual(['checking', 'update-available']);
    expect(available.controller.getPhase()).toBe('available');

    const latest = setup({
      engine: { checkForUpdates: vi.fn(async () => ({ isUpdateAvailable: false, updateInfo: { version: '0.1.0' } })) },
    });
    await latest.controller.check();
    expect(latest.statuses.map((status) => status.state)).toEqual(['checking', 'update-not-available']);

    const skipped = setup({ engine: { checkForUpdates: vi.fn(async () => null) } });
    await skipped.controller.check();
    expect(skipped.statuses.map((status) => status.state)).toEqual(['checking', 'error']);
  });

  it('runs the full user-consented update flow', async () => {
    const { controller, engine, statuses } = setup({
      engine: {
        checkForUpdates: vi.fn(async () => {
          controller.handleUpdateAvailable({ version: '0.2.0', releaseNotes: '<p>New <b>things</b></p>' });
        }),
      },
    });

    await controller.check();
    expect(statuses).toEqual([
      { state: 'checking' },
      { state: 'update-available', version: '0.2.0', releaseName: undefined, releaseNotes: 'New things' },
    ]);
    expect(engine.downloadUpdate).not.toHaveBeenCalled();

    await controller.download();
    expect(engine.downloadUpdate).toHaveBeenCalledTimes(1);
    controller.handleDownloadProgress({ percent: 42.4 });
    controller.handleUpdateDownloaded({ version: '0.2.0' });
    expect(statuses.slice(2)).toEqual([
      { state: 'download-progress', percent: 0 },
      { state: 'download-progress', percent: 42 },
      { state: 'update-downloaded', version: '0.2.0' },
    ]);

    controller.installNow();
    expect(engine.quitAndInstall).toHaveBeenCalledWith(false, true);
  });

  it('can schedule installation for when the app exits', () => {
    const { controller, engine } = setup();
    controller.handleUpdateDownloaded({ version: '0.2.0' });
    controller.installOnExit();
    expect(engine.setAutoInstallOnAppQuit).toHaveBeenCalledWith(true);
  });

  it('refuses to download or install without an available update', async () => {
    const { controller, engine, statuses } = setup();
    await controller.download();
    controller.installNow();
    expect(engine.downloadUpdate).not.toHaveBeenCalled();
    expect(engine.quitAndInstall).not.toHaveBeenCalled();
    expect(statuses.map((status) => status.state)).toEqual(['error', 'error']);
  });

  it('reports "not available" with the current version', async () => {
    const { controller, statuses } = setup({
      engine: { checkForUpdates: vi.fn(async () => controller.handleUpdateNotAvailable()) },
    });
    await controller.check();
    expect(statuses.at(-1)).toEqual({ state: 'update-not-available', version: '0.1.0' });
  });

  it('reports a readable error only once when the updater both emits and rejects', async () => {
    const failure = new Error('net::ERR_INTERNET_DISCONNECTED');
    const { controller, statuses } = setup({
      engine: {
        checkForUpdates: vi.fn(async () => {
          controller.handleError(failure);
          throw failure;
        }),
      },
    });
    await controller.check();
    const errors = statuses.filter((status) => status.state === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toEqual({
      state: 'error',
      message: 'Could not reach GitHub. Check your internet connection and try again.',
    });
    expect(controller.getPhase()).toBe('idle');
  });
});
