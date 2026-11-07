// @vitest-environment node
import { access, mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
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
  it('rejects traversal, absolute paths, and unsupported note writes', async () => {
    const service = await openService();
    await expect(service.readNote('../outside.md')).rejects.toThrow('not valid inside this library');
    await expect(service.readNote('.A11YNOTEBOOK/settings.json')).rejects.toThrow('not valid inside this library');
    await expect(service.readNote(path.join(temporaryDirectory, 'outside.md'))).rejects.toThrow(
      'not valid inside this library',
    );
    await expect(service.saveNote('note.rtf', 'unsafe')).rejects.toThrow(
      'Only Markdown, HTML, and plain-text notes can be edited',
    );
  });

  it('creates, reads, saves, and lists HTML notes as notes', async () => {
    const service = await openService();
    await service.createNote('Research.html');
    expect(await service.readNote('Research.html')).toContain('<h1>Research</h1>');
    await service.saveNote('Research.html', '<h1>Updated</h1>');
    expect(await service.readNote('Research.html')).toBe('<h1>Updated</h1>');
    expect((await service.getVault()).entries).toEqual([
      { name: 'Research.html', path: 'Research.html', kind: 'note', provenance: 'created' },
    ]);
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
        children: [{ name: 'Ideas.md', path: 'Research/Ideas.md', kind: 'note', provenance: 'created' }],
      },
    ]);
    await expect(access(path.join(temporaryDirectory, '.a11ynotebook'))).resolves.toBeUndefined();
  });

  it('saves bibliography entries and reads them back, keeping other notebooks', async () => {
    const service = await openService();
    const researchEntry = {
      id: 'entry-1',
      notebookPath: 'Research',
      sourceType: 'book' as const,
      authors: [{ last: 'Rivera', first: 'Alex' }],
      title: 'Accessible Design',
      year: '2024',
    };
    const saved = await service.saveBibliography('Research', [researchEntry]);
    expect(saved).toEqual([{ ...researchEntry, notebookPath: 'Research' }]);
    expect(await service.getBibliography('Research')).toEqual(saved);
    const archiveEntry = {
      id: 'entry-2',
      notebookPath: 'Archive',
      sourceType: 'book' as const,
      authors: [{ last: 'Doe', first: 'Jane' }],
      title: 'Older Work',
      year: '2020',
    };
    await service.saveBibliography('Archive', [archiveEntry]);
    expect(await service.getBibliography('Research')).toEqual(saved);
    expect(await service.getBibliography('Archive')).toEqual([{ ...archiveEntry, notebookPath: 'Archive' }]);
  });

  it('reads the wrapped bibliography shape as well as the flat shape', async () => {
    const service = await openService();
    await mkdir(path.join(temporaryDirectory, '.a11ynotebook'), { recursive: true });
    await writeFile(
      path.join(temporaryDirectory, '.a11ynotebook', 'bibliography.json'),
      JSON.stringify({
        notebooks: {
          Research: [
            {
              id: 'entry-1',
              notebookPath: 'Research',
              sourceType: 'book',
              authors: [{ last: 'Rivera', first: 'Alex' }],
              title: 'Accessible Design',
              year: '2024',
            },
          ],
        },
      }),
    );
    const entries = await service.getBibliography('Research');
    expect(entries).toHaveLength(1);
    expect(entries[0].title).toBe('Accessible Design');
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
