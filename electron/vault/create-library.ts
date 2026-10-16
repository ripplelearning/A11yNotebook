import { lstat, mkdir, realpath, rmdir, unlink } from 'node:fs/promises';
import path from 'node:path';

export async function createLocalLibrary<T>(
  selected: string,
  activate: (root: string) => Promise<T>,
  assertCurrent: () => void,
) {
  const name = path.basename(selected);
  if (
    !name ||
    name === '.' ||
    name === '..' ||
    name.startsWith('.') ||
    /[<>:"/\\|?*]/.test(name) ||
    [...name].some((character) => character.charCodeAt(0) < 32) ||
    /[. ]$/.test(name) ||
    /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)
  )
    throw new Error('Choose a valid name for the new local library.');
  const parent = await realpath(path.dirname(selected));
  if (!(await lstat(parent)).isDirectory()) throw new Error('Choose an existing parent folder.');
  const root = path.join(parent, name);
  assertCurrent();
  await mkdir(root, { mode: 0o700 }); // Exclusive: never initialize or overwrite an existing folder.
  const identity = await lstat(root);
  try {
    assertCurrent();
    return await activate(root);
  } catch (error) {
    const current = await lstat(root).catch(() => null);
    if (
      current?.isDirectory() &&
      !current.isSymbolicLink() &&
      current.dev === identity.dev &&
      current.ino === identity.ino
    ) {
      // Only the disposable index belongs to initialization. Never recursively
      // delete a folder into which another process may have written user files.
      const metadata = path.join(root, '.a11ynotebook');
      const stat = await lstat(metadata).catch(() => null);
      if (stat?.isDirectory() && !stat.isSymbolicLink()) {
        await unlink(path.join(metadata, 'search-index.json')).catch(() => undefined);
        await rmdir(metadata).catch(() => undefined);
      }
      await rmdir(root).catch(() => undefined);
    }
    const residual = await lstat(root).then(
      () => true,
      (failure: NodeJS.ErrnoException) => failure.code !== 'ENOENT',
    );
    if (residual) {
      const reason = error instanceof Error ? error.message : 'Library initialization failed.';
      throw new Error(
        `${reason} A folder remains at "${root}". Check its contents before retrying; user files were not recursively removed.`,
      );
    }
    throw error;
  }
}
