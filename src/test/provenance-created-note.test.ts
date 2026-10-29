// @vitest-environment node
// A note created in the app must scan as a managed note after it is
// saved and after the vault is re-read (the close-and-reopen path), and
// the stored origin record must match the created file's own identity,
// not a staging identity left behind by the commit step.
import { createHash } from 'node:crypto';
import { lstat, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createVaultService } from '../../electron/vault/service';

describe('created-note provenance', () => {
  it('keeps created provenance across save and re-read', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'a11y-prov-'));
    try {
      const service = createVaultService(dir);
      await service.initialize();
      let view = await service.createNote('testing.md');
      expect(view.entries.find((entry) => entry.path === 'testing.md')?.provenance).toBe('created');
      const content = await service.readNote('testing.md');
      await service.saveNote('testing.md', `${content}Some typed text.\n`, content);
      view = await service.getVault();
      expect(view.entries.find((entry) => entry.path === 'testing.md')?.provenance).toBe('created');
      // Simulate close + reopen: a fresh service instance re-reads the vault.
      const reopened = createVaultService(dir);
      await reopened.initialize();
      const reread = await reopened.getVault();
      expect(reread.entries.find((entry) => entry.path === 'testing.md')?.provenance).toBe('created');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('records the created file’s own identity, not the staging identity', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'a11y-prov-'));
    try {
      const service = createVaultService(dir);
      await service.initialize();
      await service.createNote('testing.md');
      const target = path.join(dir, 'testing.md');
      const stat = await lstat(target);
      const expected = createHash('sha256')
        .update(`${stat.dev}:${stat.ino}:${stat.birthtimeMs}`)
        .digest('hex');
      const raw = JSON.parse(
        await readFile(path.join(dir, '.a11ynotebook', 'provenance.json'), 'utf8'),
      ) as { records: Record<string, string> };
      expect(raw.records[expected]).toBe('created');
      expect(Object.keys(raw.records)).toHaveLength(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
