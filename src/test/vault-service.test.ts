// @vitest-environment node
import { access, mkdtemp, mkdir, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createVaultService } from '../../electron/vault/service';

let temporaryDirectory = '';

async function openService() {
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'a11y-vault-'));
  const service = createVaultService(temporaryDirectory);
  await service.initialize();
  return service;
}

afterEach(async () => {
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
});

describe('vault filesystem service', () => {
  it('rejects traversal, absolute paths, and non-Markdown note writes', async () => {
    const service = await openService();
    await expect(service.readNote('../outside.md')).rejects.toThrow('not valid inside this vault');
    await expect(service.readNote('.A11YNOTEBOOK/settings.json')).rejects.toThrow('not valid inside this vault');
    await expect(service.readNote(path.join(temporaryDirectory, 'outside.md'))).rejects.toThrow(
      'not valid inside this vault',
    );
    await expect(service.saveNote('note.txt', 'unsafe')).rejects.toThrow('Only Markdown notes can be edited');
  });

  it('creates, saves, reads, and lists Markdown notes while hiding metadata', async () => {
    const service = await openService();
    await service.createFolder('Research');
    await service.createNote('Research/Ideas.md');
    await service.saveNote('Research/Ideas.md', '# Ideas\n\nA local note.');
    expect(await service.readNote('Research/Ideas.md')).toBe('# Ideas\n\nA local note.');
    const vault = await service.getVault();
    expect(vault.entries).toEqual([
      {
        name: 'Research',
        path: 'Research',
        kind: 'notebook',
        children: [{ name: 'Ideas.md', path: 'Research/Ideas.md', kind: 'note' }],
      },
    ]);
    await expect(access(path.join(temporaryDirectory, '.a11ynotebook'))).resolves.toBeUndefined();
  });

  it.skipIf(process.platform === 'win32')('rejects a symlink path before it can escape the vault', async () => {
    const service = await openService();
    const outside = await mkdtemp(path.join(os.tmpdir(), 'a11y-outside-'));
    await mkdir(outside, { recursive: true });
    await symlink(outside, path.join(temporaryDirectory, 'escape'), 'dir');
    await expect(service.readNote('escape/secret.md')).rejects.toThrow('Symbolic links are not supported');
    await rm(outside, { recursive: true, force: true });
  });
});
