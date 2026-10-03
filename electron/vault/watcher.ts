import { watch, type FSWatcher } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { checkedVaultPath, isVisibleVaultPath } from './search';
import type { VaultChangedEvent } from '../../src/shared/search';

export interface VaultWatcherOptions {
  debounceMs?: number;
  /** Useful for environments where recursive fs.watch is unavailable. */
  recursive?: boolean;
  onError?: (error: unknown) => void;
}

export async function createVaultWatcher(
  root: string,
  onChanged: (event: VaultChangedEvent) => void | Promise<void>,
  options: VaultWatcherOptions = {},
) {
  const watchers = new Map<string, FSWatcher>();
  const pending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  let recursive = options.recursive ?? (process.platform === 'win32' || process.platform === 'darwin');
  let running: Promise<void> = Promise.resolve();

  function report(error: unknown) {
    try {
      options.onError?.(error);
    } catch {
      /* An error reporter must not cause an unhandled rejection. */
    }
  }

  function schedule(relative: string) {
    if (closed || (relative && !isVisibleVaultPath(relative))) return;
    pending.add(relative);
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      running = running
        .then(async () => {
          if (closed || !pending.size) return;
          const paths = [...pending].sort();
          pending.clear();
          if (!recursive) await reconcile();
          if (!closed) await onChanged({ vaultPath: root, paths });
        })
        .catch(report);
    }, options.debounceMs ?? 100);
  }

  function attach(relative: string, recursiveWatch = false) {
    if (closed) return;
    const absolute = relative ? path.join(root, relative) : root;
    const watcher = watch(absolute, { recursive: recursiveWatch }, (_event, filename) => {
      const name = filename?.toString().replace(/\\/g, '/');
      schedule(name ? (relative ? `${relative}/${name}` : name) : relative);
    });
    watcher.on('error', (error) => {
      watcher.close();
      watchers.delete(relative);
      report(error);
      schedule(relative);
    });
    watchers.set(relative, watcher);
  }

  async function reconcile() {
    const directories = new Set<string>();
    async function walk(relative: string) {
      if (closed) return;
      try {
        const absolute = relative ? await checkedVaultPath(root, relative) : root;
        if (closed) return;
        directories.add(relative);
        if (!watchers.has(relative)) attach(relative);
        for (const entry of await readdir(absolute, { withFileTypes: true })) {
          if (entry.isDirectory() && !entry.isSymbolicLink() && !entry.name.startsWith('.')) {
            await walk(relative ? `${relative}/${entry.name}` : entry.name);
          }
        }
      } catch (error) {
        if (
          !['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '') &&
          !(error instanceof Error && error.message.includes('Symbolic links'))
        )
          report(error);
      }
    }
    await walk('');
    for (const [relative, watcher] of watchers) {
      if (!directories.has(relative)) {
        watcher.close();
        watchers.delete(relative);
      }
    }
  }

  if (recursive) {
    try {
      attach('', true);
    } catch {
      recursive = false;
    }
  }
  if (!recursive) await reconcile();
  if (!watchers.has('')) throw new Error('Unable to watch the vault folder.');

  return {
    async dispose() {
      closed = true;
      if (timer) clearTimeout(timer);
      for (const watcher of watchers.values()) watcher.close();
      watchers.clear();
      pending.clear();
      await running;
    },
  };
}
