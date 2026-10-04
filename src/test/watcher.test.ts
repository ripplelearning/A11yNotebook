// @vitest-environment node
import { mkdtemp, mkdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createVaultWatcher } from '../../electron/vault/watcher';
import { createVaultService } from '../../electron/vault/service';
import type { VaultChangedEvent } from '../shared/search';

const directories: string[] = [];
const disposables: Array<{ dispose(): Promise<void> }> = [];

async function folder() {
  const root = await mkdtemp(path.join(process.cwd(), '.watcher-test-'));
  directories.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(disposables.splice(0).map((item) => item.dispose()));
  await Promise.all(directories.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('external vault watcher', () => {
  it('debounces fallback directory events and sends absolute vault identity plus relative paths', async () => {
    const root = await folder();
    await mkdir(path.join(root, 'Work'));
    const events: VaultChangedEvent[] = [];
    const watcher = await createVaultWatcher(
      root,
      (event) => {
        events.push(event);
      },
      { recursive: false, debounceMs: 80 },
    );
    disposables.push(watcher);
    await Promise.all([
      writeFile(path.join(root, 'Work', 'one.md'), 'one'),
      writeFile(path.join(root, 'Work', 'two.md'), 'two'),
    ]);
    await vi.waitFor(() => expect(events).toHaveLength(1), { timeout: 3000 });
    expect(events[0].vaultPath).toBe(root);
    expect(events[0].paths).toEqual(['Work/one.md', 'Work/two.md']);
  });

  it('reconciles new, renamed, and deleted directories without restarting', async () => {
    const root = await folder();
    const events: VaultChangedEvent[] = [];
    disposables.push(
      await createVaultWatcher(
        root,
        (event) => {
          events.push(event);
        },
        { recursive: false, debounceMs: 20 },
      ),
    );
    await mkdir(path.join(root, 'New'));
    await vi.waitFor(() => expect(events.some((event) => event.paths.includes('New'))).toBe(true), { timeout: 3000 });
    await writeFile(path.join(root, 'New', 'first.md'), 'first');
    await vi.waitFor(() => expect(events.some((event) => event.paths.includes('New/first.md'))).toBe(true), {
      timeout: 3000,
    });
    await rename(path.join(root, 'New'), path.join(root, 'Renamed'));
    await vi.waitFor(() => expect(events.some((event) => event.paths.includes('Renamed'))).toBe(true), {
      timeout: 3000,
    });
    await writeFile(path.join(root, 'Renamed', 'second.md'), 'second');
    await vi.waitFor(() => expect(events.some((event) => event.paths.includes('Renamed/second.md'))).toBe(true), {
      timeout: 3000,
    });
    await rm(path.join(root, 'Renamed'), { recursive: true });
    await vi.waitFor(
      () => expect(events.filter((event) => event.paths.includes('Renamed')).length).toBeGreaterThan(1),
      { timeout: 3000 },
    );
  });

  it('exposes runtime watcher failures through the optional service error callback', async () => {
    const root = await folder();
    const service = createVaultService(root);
    disposables.push(service);
    await service.initialize();
    const failure = new Error('Failed to announce vault changes');
    const onError = vi.fn();
    await service.startWatcher(() => {
      throw failure;
    }, onError);
    await writeFile(path.join(root, 'Note.md'), '# External');
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(failure), { timeout: 3000 });
    expect(await service.search({ text: 'External' })).toHaveLength(1);
  });

  it('ignores hidden paths and metadata writes and stops pending notifications on disposal', async () => {
    const root = await folder();
    await mkdir(path.join(root, '.a11ynotebook'));
    await mkdir(path.join(root, '.hidden'));
    const callback = vi.fn();
    const watcher = await createVaultWatcher(root, callback, { recursive: false, debounceMs: 80 });
    disposables.push(watcher);
    await writeFile(path.join(root, '.hidden.md'), 'hidden');
    await writeFile(path.join(root, '.hidden', 'inside.md'), 'hidden');
    await writeFile(path.join(root, '.a11ynotebook', 'search-index.json'), '{}');
    await new Promise((resolve) => setTimeout(resolve, 180));
    expect(callback).not.toHaveBeenCalled();
    await writeFile(path.join(root, 'visible.md'), 'visible');
    await watcher.dispose();
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(callback).not.toHaveBeenCalled();
  });

  it('reports callback errors without unhandled rejections and continues watching', async () => {
    const root = await folder();
    const error = new Error('Callback failed');
    const callback = vi.fn().mockRejectedValueOnce(error).mockResolvedValue(undefined);
    const onError = vi.fn();
    disposables.push(await createVaultWatcher(root, callback, { recursive: false, debounceMs: 20, onError }));
    await writeFile(path.join(root, 'first.md'), 'first');
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(error), { timeout: 3000 });
    await writeFile(path.join(root, 'second.md'), 'second');
    await vi.waitFor(() => expect(callback).toHaveBeenCalledTimes(2), { timeout: 3000 });
  });

  it('refreshes service search before announcing an external edit, rename, or removal', async () => {
    const root = await folder();
    await writeFile(path.join(root, 'Note.md'), 'old content');
    const events: Array<{ event: VaultChangedEvent; matches: string[] }> = [];
    const service = createVaultService(root, async (event) => {
      events.push({ event, matches: (await service.search({ text: 'fresh' })).map((result) => result.path) });
    });
    disposables.push(service);
    await service.initialize();
    await writeFile(path.join(root, 'Note.md'), 'fresh content');
    await vi.waitFor(() => expect(events.at(-1)?.matches).toEqual(['Note.md']), { timeout: 4000 });
    await rename(path.join(root, 'Note.md'), path.join(root, 'Renamed.md'));
    await vi.waitFor(() => expect(events.at(-1)?.matches).toEqual(['Renamed.md']), { timeout: 4000 });
    await rm(path.join(root, 'Renamed.md'));
    await vi.waitFor(() => expect(events.at(-1)?.matches).toEqual([]), { timeout: 4000 });
    expect(events.every(({ event }) => event.vaultPath === root)).toBe(true);
    await service.dispose();
    await expect(service.startWatcher(() => undefined)).rejects.toThrow('Open a vault');
  });

  it.skipIf(process.platform === 'win32')(
    'does not attach fallback watchers to symlinked outside folders',
    async () => {
      const root = await folder();
      const outside = await folder();
      await symlink(outside, path.join(root, 'escape'), 'dir');
      const callback = vi.fn();
      disposables.push(await createVaultWatcher(root, callback, { recursive: false, debounceMs: 20 }));
      await writeFile(path.join(outside, 'secret.md'), 'outside');
      await new Promise((resolve) => setTimeout(resolve, 120));
      expect(callback).not.toHaveBeenCalled();
    },
  );
});
