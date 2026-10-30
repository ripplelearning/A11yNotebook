// @vitest-environment node
// Once a managed copy is imported from a file already in the library,
// the original is flagged superseded so views hide it, and deleting the
// copy drops the flag on the next scan so the original comes back.
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createVaultService } from '../../electron/vault/service';

describe('superseded originals', () => {
  it('flags the source superseded after import, keeps the flag on re-read, and clears it when the copy is deleted', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'a11y-superseded-'));
    try {
      await writeFile(path.join(dir, 'Outside.md'), '# Outside\n');
      const service = createVaultService(dir);
      await service.initialize();
      let view = await service.getVault();
      const original = view.entries.find((entry) => entry.path === 'Outside.md');
      expect(original?.provenance).toBeUndefined();
      expect(original?.superseded).toBeUndefined();

      const imported = await service.importEntry('Outside.md');
      expect(imported.path).toMatch(/^Imported-[0-9a-f-]+-Outside\.md$/);
      const flagged = imported.vault.entries.find((entry) => entry.path === 'Outside.md');
      expect(flagged?.superseded).toBe(true);
      expect(imported.vault.entries.find((entry) => entry.path === imported.path)?.provenance).toBe('imported');

      // Simulate close + reopen: a fresh service instance re-reads the flag.
      const reopened = createVaultService(dir);
      await reopened.initialize();
      const reread = await reopened.getVault();
      expect(reread.entries.find((entry) => entry.path === 'Outside.md')?.superseded).toBe(true);

      // Deleting the copy (here directly, as an outside delete would) drops
      // the record on the next scan, so the original comes back.
      await rm(path.join(dir, imported.path), { force: true });
      view = await service.getVault();
      expect(view.entries.find((entry) => entry.path === 'Outside.md')?.superseded).toBeUndefined();
      expect(view.entries.some((entry) => entry.path === imported.path)).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('does not supersede anything when importing a file from outside the library', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'a11y-superseded-'));
    // macOS temp folders sit under /var, a symlink; the import guard rejects
    // symlinked paths, so canonicalize the outside folder first.
    const outside = await realpath(await mkdtemp(path.join(os.tmpdir(), 'a11y-superseded-outside-')));
    try {
      const service = createVaultService(dir);
      await service.initialize();
      await writeFile(path.join(outside, 'Elsewhere.md'), '# Elsewhere\n');
      const view = await service.importFile(path.join(outside, 'Elsewhere.md'), '');
      expect(view.entries.some((entry) => entry.superseded)).toBe(false);
      expect(view.entries.some((entry) => entry.path === 'Elsewhere.md')).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('supersedes the original when Import file picks a file already inside the library', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'a11y-superseded-'));
    try {
      await writeFile(path.join(dir, 'Inside.md'), '# Inside\n');
      const service = createVaultService(dir);
      await service.initialize();
      const view = await service.importFile(path.join(dir, 'Inside.md'), '');
      expect(view.entries.find((entry) => entry.path === 'Inside.md')?.superseded).toBe(true);
      expect(view.entries.some((entry) => /^Imported-[0-9a-f-]+-Inside\.md$/.test(entry.path))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('records the copy identity, not just its path, so a renamed copy still supersedes', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'a11y-superseded-'));
    try {
      await writeFile(path.join(dir, 'Outside.md'), '# Outside\n');
      const service = createVaultService(dir);
      await service.initialize();
      const imported = await service.importEntry('Outside.md');
      const raw = JSON.parse(
        await readFile(path.join(dir, '.a11ynotebook', 'superseded.json'), 'utf8'),
      ) as { records: Record<string, { copy: string; path: string }> };
      const records = Object.values(raw.records);
      expect(records).toHaveLength(1);
      expect(records[0].path).toBe(imported.path);
      expect(records[0].copy).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
