// @vitest-environment node
import { lstat, mkdir, readFile, rename, rm, symlink, truncate, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createVaultService } from '../../electron/vault/service';
import { createAssetStore } from '../../electron/vault/assets';
import { createMetadataStore } from '../../electron/vault/metadata';

let root: string;
let service: ReturnType<typeof createVaultService>;
beforeEach(async () => {
  root = path.join(process.cwd(), `.vault-workflow-${randomUUID()}`);
  await mkdir(root);
  service = createVaultService(root);
  await service.initialize();
});
afterEach(async () => {
  await service.dispose();
  await rm(root, { recursive: true, force: true });
});

describe('trusted creation and import workflows', () => {
  it('creates unique task notes in the root or selected notebook and indexes them', async () => {
    await service.createFolder('Work');
    const first = await service.createTask({ notebookPath: 'Work', text: '  Plan accessibility review  ' });
    expect(first).toEqual([expect.objectContaining({ text: 'Plan accessibility review', complete: false })]);
    expect(first[0].path).toMatch(/^Work\/Tasks-[\w-]+\.md$/);
    const all = await service.createTask({ text: 'Second task' });
    expect(all).toHaveLength(2);
    expect(await service.search({ text: 'accessibility' })).toHaveLength(1);
    expect(await service.getProvenance(first[0].path)).toBe('app-created');
  });

  it('rejects malformed tasks and queued revoked access without creating files', async () => {
    for (const input of [
      null,
      {},
      { text: '' },
      { text: 'two\nlines' },
      { text: 'x'.repeat(1001) },
      { text: 'ok', notebookPath: '../escape' },
    ])
      await expect(service.createTask(input)).rejects.toThrow();
    await expect(
      service.createTask({ text: 'Blocked' }, () => {
        throw new Error('Locked');
      }),
    ).rejects.toThrow('Locked');
    expect((await service.getVault()).entries).toEqual([]);
  });

  it('tracks note and asset creation durably, preserves edits, and remaps folders', async () => {
    await service.createFolder('Work');
    await service.createNote('Work/Topic.md', '# Topic');
    const assets = createAssetStore(service, createMetadataStore(service));
    await assets.create('Work/Plan.outline.md', '- First');
    await assets.save('Work/Plan.outline.md', '- Next', '- First');
    await writeFile(path.join(root, 'Work/Topic.md'), '# Edited externally');
    expect(await service.getProvenance('Work/Topic.md')).toBe('app-created');
    await service.moveEntry('Work', 'Archive');
    await service.saveNote('Archive/Topic.md', '# Saved in app');
    await service.dispose();
    service = createVaultService(root);
    await service.initialize();
    expect(await service.getProvenance('Archive/Topic.md')).toBe('app-created');
    expect(await service.getProvenance('Archive/Plan.outline.md')).toBe('app-created');
    const replacement = path.join(root, 'replacement.md');
    await writeFile(replacement, '# Replacement');
    await rename(replacement, path.join(root, 'Archive/Topic.md'));
    expect(await service.getProvenance('Archive/Topic.md')).toBe('unknown');
    await service.removeProvenance('Archive');
    expect(await service.getProvenance('Archive/Plan.outline.md')).toBe('unknown');
  });

  it('returns explicit unknown provenance for existing files and folders', async () => {
    await mkdir(path.join(root, 'External'));
    await writeFile(path.join(root, 'External/Old.md'), '# Old');
    const entry = (await service.getVault()).entries[0];
    expect(entry.provenance).toBe('unknown');
    expect(entry.children?.[0].provenance).toBe('unknown');
  });

  it('imports a sanitized copy without changing the source, including after reopen', async () => {
    const original =
      '<h1>Safe</h1><script>alert(1)</script><img src="https://example.test/tracker.png" onerror="bad()">';
    await writeFile(path.join(root, 'External.html'), original);
    const imported = await service.importEntry('External.html');
    const copy = imported.vault.entries.find((entry) => entry.provenance === 'imported')!;
    expect(imported.path).toBe(copy.path);
    expect(copy.path).not.toBe('External.html');
    expect(await readFile(path.join(root, 'External.html'), 'utf8')).toBe(original);
    const content = await service.readNote(copy.path);
    expect(content).toContain('Safe');
    expect(content).not.toMatch(/<script|onerror|https:\/\/example/);
    await service.dispose();
    service = createVaultService(root);
    await service.initialize();
    expect(await service.getProvenance(copy.path)).toBe('imported');
    expect(await service.getProvenance('External.html')).toBe('unknown');
  });

  it('explicit file import records compatible notes and assets as imported', async () => {
    await service.createFolder('Imported');
    await writeFile(path.join(root, 'Source.md'), '# Source');
    await service.importFile(path.join(root, 'Source.md'), 'Imported');
    expect(await service.getProvenance('Imported/Source.md')).toBe('imported');
    await expect(service.importFile(path.join(root, 'Source.md'), 'Imported')).rejects.toThrow();
    expect(await readFile(path.join(root, 'Imported/Source.md'), 'utf8')).toBe('# Source');
    const html = '<h1>External HTML</h1><script>unsafe()</script>';
    await writeFile(path.join(root, 'Source.html'), html);
    await service.importFile(path.join(root, 'Source.html'), 'Imported');
    expect(await service.getProvenance('Imported/Source.html')).toBe('imported');
    expect(await service.readNote('Imported/Source.html')).not.toContain('<script>');
    expect(await readFile(path.join(root, 'Source.html'), 'utf8')).toBe(html);
    await writeFile(path.join(root, 'Source.outline.md'), '- Imported outline');
    await service.importFile(path.join(root, 'Source.outline.md'), 'Imported');
    expect(await service.getProvenance('Imported/Source.outline.md')).toBe('imported');
    const assets = createAssetStore(service, createMetadataStore(service));
    expect((await assets.read('Imported/Source.outline.md')).content).toBe('- Imported outline');
  });

  it('rejects unsupported, oversized, invalid asset, and symlink inputs', async () => {
    await writeFile(path.join(root, 'Program.exe'), 'program');
    await expect(service.importEntry('Program.exe')).rejects.toThrow('not supported');
    await writeFile(path.join(root, 'Bad.mindmap.json'), '{invalid');
    await expect(service.importEntry('Bad.mindmap.json')).rejects.toThrow();
    await writeFile(path.join(root, 'Huge.md'), Buffer.alloc(8 * 1024 * 1024 + 1));
    await expect(service.importEntry('Huge.md')).rejects.toThrow('too large');
    if (process.platform !== 'win32') {
      await symlink(path.join(root, 'Huge.md'), path.join(root, 'Link.md'));
      await expect(service.importEntry('Link.md')).rejects.toThrow('Symbolic');
    }
    expect((await lstat(path.join(root, 'Program.exe'))).isFile()).toBe(true);
  });

  it('preserves explicit arbitrary attachment imports without enabling internal conversion', async () => {
    await service.createFolder('Imported');
    const original = Buffer.from([0, 1, 2, 3, 255]);
    await writeFile(path.join(root, 'Attachment.bin'), original);
    await service.importFile(path.join(root, 'Attachment.bin'), 'Imported');
    expect(await readFile(path.join(root, 'Imported/Attachment.bin'))).toEqual(original);
    expect(await service.getProvenance('Imported/Attachment.bin')).toBe('imported');
    await expect(service.importEntry('Imported/Attachment.bin')).rejects.toThrow('not supported');
    await writeFile(path.join(root, 'README'), 'An extensionless attachment');
    await service.importFile(path.join(root, 'README'), 'Imported');
    expect(await readFile(path.join(root, 'Imported/README'), 'utf8')).toBe('An extensionless attachment');
  });

  it.each([
    ['Text.txt', 5],
    ['Image.png', 20],
    ['Note.md', 8],
    ['Outline.outline.md', 2],
    ['Document.pdf', 40],
  ])('rejects %s above its usable reader size limit', async (filename, limitMiB) => {
    const source = path.join(root, String(filename));
    await writeFile(source, '');
    await truncate(source, Number(limitMiB) * 1024 * 1024 + 1);
    await expect(service.importEntry(String(filename))).rejects.toThrow('too large');
  });
});
