// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createVaultService } from '../../electron/vault/service';

let temporaryDirectory = '';

async function openService() {
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'a11y-link-test-'));
  const service = createVaultService(temporaryDirectory);
  await service.initialize();
  return service;
}

afterEach(async () => {
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
});

describe('link notes (standalone .url grid items)', () => {
  it('creates a .url file that scans as a link', async () => {
    const service = await openService();
    await service.createFolder('Research');
    const created = await service.createLink({
      title: 'Example Site',
      url: 'https://example.com/guide',
      notebookPath: 'Research',
    });
    expect(created.path).toBe('Research/Example Site.url');
    expect(await readFile(path.join(temporaryDirectory, created.path), 'utf8')).toBe(
      '[InternetShortcut]\r\nURL=https://example.com/guide\r\n',
    );
    const vault = await service.getVault();
    expect(vault.entries).toEqual([
      {
        name: 'Research',
        path: 'Research',
        kind: 'notebook',
        children: [
          { name: 'Example Site.url', path: 'Research/Example Site.url', kind: 'link', provenance: 'created' },
        ],
      },
    ]);
  });

  it('numbers a taken link name instead of overwriting', async () => {
    const service = await openService();
    const first = await service.createLink({ title: 'Example Site', url: 'https://example.com/one' });
    const second = await service.createLink({ title: 'Example Site', url: 'https://example.com/two' });
    expect(first.path).toBe('Example Site.url');
    expect(second.path).toBe('Example Site 2.url');
  });

  it('turns a typed title into a safe file name', async () => {
    const service = await openService();
    const created = await service.createLink({ title: 'A/B: C?', url: 'https://example.com' });
    expect(created.path).toBe('A-B- C-.url');
  });

  it('rejects an empty title, a disallowed scheme, and a missing notebook', async () => {
    const service = await openService();
    await expect(service.createLink({ title: ' ', url: 'https://example.com' })).rejects.toThrow(
      'Enter a link title',
    );
    await expect(service.createLink({ title: 'Example', url: 'ftp://example.com/file' })).rejects.toThrow(
      'Enter a link title and a web address',
    );
    await expect(
      service.createLink({ title: 'Example', url: 'https://example.com', notebookPath: 'Nope' }),
    ).rejects.toThrow();
  });

  it('scans a .url file placed in the notebook as a link', async () => {
    const service = await openService();
    await writeFile(
      path.join(temporaryDirectory, 'Other.url'),
      '[InternetShortcut]\r\nURL=https://example.com/other\r\n',
    );
    const vault = await service.getVault();
    expect(vault.entries).toEqual([{ name: 'Other.url', path: 'Other.url', kind: 'link' }]);
  });

  it('edits the address in place and keeps other lines in the file', async () => {
    const service = await openService();
    await writeFile(
      path.join(temporaryDirectory, 'Example Site.url'),
      '[InternetShortcut]\r\nURL=https://example.com/old\r\nIconFile=icon.ico\r\n',
    );
    const saved = await service.saveLink({
      path: 'Example Site.url',
      title: 'Example Site',
      url: 'https://example.com/new',
    });
    expect(saved.path).toBe('Example Site.url');
    expect(await readFile(path.join(temporaryDirectory, 'Example Site.url'), 'utf8')).toBe(
      '[InternetShortcut]\r\nURL=https://example.com/new\r\nIconFile=icon.ico\r\n',
    );
  });

  it('renames the file when the title changes', async () => {
    const service = await openService();
    await service.createLink({ title: 'Old Title', url: 'https://example.com' });
    const saved = await service.saveLink({
      path: 'Old Title.url',
      title: 'New Title',
      url: 'https://example.com',
    });
    expect(saved.path).toBe('New Title.url');
    const vault = await service.getVault();
    expect(vault.entries).toEqual([
      { name: 'New Title.url', path: 'New Title.url', kind: 'link', provenance: 'created' },
    ]);
  });

  it('refuses to edit a protected link', async () => {
    const service = await openService();
    const created = await service.createLink({ title: 'Example Site', url: 'https://example.com' });
    await service.setProtection(created.path, true);
    await expect(
      service.saveLink({ path: created.path, title: 'Example Site', url: 'https://example.com/new' }),
    ).rejects.toThrow('protected');
  });

  it('rejects editing a non-link file', async () => {
    const service = await openService();
    await service.createNote('Note.md', '# Note');
    await expect(
      service.saveLink({ path: 'Note.md', title: 'Note', url: 'https://example.com' }),
    ).rejects.toThrow('Enter a link title and a web address');
  });

  it('indexes link titles and addresses for search', async () => {
    const service = await openService();
    await service.createLink({ title: 'Example Site', url: 'https://example.com/guide' });
    const byTitle = await service.search({ text: 'Example Site' });
    expect(byTitle).toHaveLength(1);
    expect(byTitle[0]?.path).toBe('Example Site.url');
    const byUrl = await service.search({ text: 'example.com/guide' });
    expect(byUrl).toHaveLength(1);
    expect(byUrl[0]?.path).toBe('Example Site.url');
  });
});
