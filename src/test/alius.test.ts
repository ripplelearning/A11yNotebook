// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { validateAliusTarget } from '../../electron/vault/alius';
import { createVaultService } from '../../electron/vault/service';
import { aliusFileName, formatAliusFile, isAliusPath, parseAliusTarget } from '../shared/alius';

describe('Alius record format', () => {
  it('round-trips the target through the record file', () => {
    const target = 'C:\\Users\\tristen\\Documents\\Budget.xlsx';
    expect(parseAliusTarget(formatAliusFile(target))).toBe(target);
    expect(JSON.parse(formatAliusFile(target))).toEqual({ version: 1, target });
  });

  it('rejects records that are not a valid version-1 Alius', () => {
    expect(parseAliusTarget('not json')).toBeNull();
    expect(parseAliusTarget('{"version": 2, "target": "C:\\a.md"}')).toBeNull();
    expect(parseAliusTarget('{"version": 1}')).toBeNull();
    expect(parseAliusTarget('{"version": 1, "target": "  "}')).toBeNull();
    expect(parseAliusTarget('["C:\\a.md"]')).toBeNull();
  });

  it('tolerates a UTF-8 byte-order mark at the start of the record', () => {
    expect(parseAliusTarget(`\uFEFF${formatAliusFile('C:\\a.md')}`)).toBe('C:\\a.md');
  });

  it('names the record after the source file, keeping its full name', () => {
    expect(aliusFileName('Budget.xlsx')).toBe('Budget.xlsx.alius');
    expect(aliusFileName('Notes.md')).toBe('Notes.md.alius');
    expect(aliusFileName('a/b:bad?.md')).toBe('a-b-bad-.md.alius');
    expect(aliusFileName('   ')).toBe('Alius.alius');
  });

  it('recognizes .alius paths regardless of case', () => {
    expect(isAliusPath('Research/Budget.xlsx.alius')).toBe(true);
    expect(isAliusPath('Research/Budget.xlsx.ALIUS')).toBe(true);
    expect(isAliusPath('Research/Budget.xlsx')).toBe(false);
  });
});

describe('Alius target validation', () => {
  let outside: string;

  beforeEach(async () => {
    outside = path.join(process.cwd(), `.alius-targets-${randomUUID()}`);
    await mkdir(outside, { recursive: true });
  });

  afterEach(async () => {
    await rm(outside, { recursive: true, force: true });
  });

  it('accepts a regular Markdown file', async () => {
    const target = path.join(outside, 'Notes.md');
    await writeFile(target, '# Notes');
    await expect(validateAliusTarget(target)).resolves.toBeUndefined();
  });

  it('refuses executables and scripts', async () => {
    const target = path.join(outside, 'Setup.exe');
    await writeFile(target, 'MZ');
    await expect(validateAliusTarget(target)).rejects.toThrow(/executable|script/i);
  });

  it('refuses a missing file', async () => {
    await expect(validateAliusTarget(path.join(outside, 'Gone.md'))).rejects.toThrow();
  });

  it('refuses a directory', async () => {
    await expect(validateAliusTarget(outside)).rejects.toThrow();
  });
});

describe('Alius service behavior', () => {
  let root: string;
  let outside: string;
  let service: ReturnType<typeof createVaultService>;

  beforeEach(async () => {
    root = path.join(process.cwd(), `.alius-library-${randomUUID()}`);
    outside = path.join(process.cwd(), `.alius-targets-${randomUUID()}`);
    await mkdir(root);
    await mkdir(outside);
    service = createVaultService(root);
    await service.initialize();
  });

  afterEach(async () => {
    await service?.dispose();
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  async function makeTarget(name: string, content: string): Promise<string> {
    const target = path.join(outside, name);
    await writeFile(target, content);
    return target;
  }

  async function findEntry(recordPath: string) {
    const vault = await service.getVault();
    const entry = vault.entries.find((item) => item.path === recordPath);
    expect(entry).toBeDefined();
    return entry!;
  }

  it('creates an Alius record without copying the original', async () => {
    const target = await makeTarget('Outside.md', '# Outside');
    const created = await service.createAlius({ source: target, notebookPath: '' });
    expect(created.path).toBe('Outside.md.alius');
    expect(await readFile(path.join(root, created.path), 'utf8')).toBe(formatAliusFile(target));
    // The original is untouched and never copied into the library.
    expect(await readFile(target, 'utf8')).toBe('# Outside');
    const entry = await findEntry(created.path);
    expect(entry.kind).toBe('link');
    expect(entry.aliusTarget).toBe(target);
    expect(entry.aliusBroken).toBe(false);
  });

  it('numbers the record name when one already exists', async () => {
    const target = await makeTarget('Outside.md', '# Outside');
    const first = await service.createAlius({ source: target, notebookPath: '' });
    const second = await service.createAlius({ source: target, notebookPath: '' });
    expect(first.path).toBe('Outside.md.alius');
    expect(second.path).toBe('Outside.md 2.alius');
  });

  it('refuses an executable target at creation', async () => {
    const target = await makeTarget('Setup.exe', 'MZ');
    await expect(service.createAlius({ source: target, notebookPath: '' })).rejects.toThrow(/executable|script/i);
  });

  it('reads note text through the Alius and saves back to the original', async () => {
    const target = await makeTarget('Outside.md', '# Outside');
    const created = await service.createAlius({ source: target, notebookPath: '' });
    expect(await service.readNote(created.path)).toBe('# Outside');
    await service.saveNote(created.path, '# Edited', '# Outside');
    expect(await readFile(target, 'utf8')).toBe('# Edited');
    // The record file itself is unchanged by the save.
    expect(await readFile(path.join(root, created.path), 'utf8')).toBe(formatAliusFile(target));
  });

  it('shows a broken Alius when the original is gone, and retargets it', async () => {
    const target = await makeTarget('Outside.md', '# Outside');
    const created = await service.createAlius({ source: target, notebookPath: '' });
    await rm(target);
    const broken = await findEntry(created.path);
    expect(broken.aliusTarget).toBe(target);
    expect(broken.aliusBroken).toBe(true);
    // The record still names the missing original.
    expect(await service.resolveAlius(created.path)).toEqual({ target });
    await expect(service.readNote(created.path)).rejects.toThrow('no longer available');
    const replacement = await makeTarget('Replacement.md', '# Replacement');
    const retargeted = await service.saveAlius({ path: created.path, target: replacement });
    expect(retargeted.path).toBe(created.path);
    const healed = await findEntry(created.path);
    expect(healed.aliusTarget).toBe(replacement);
    expect(healed.aliusBroken).toBe(false);
    expect(await service.readNote(created.path)).toBe('# Replacement');
  });

  it('refuses to save when the original changed outside the app (Q4)', async () => {
    const target = await makeTarget('Outside.md', '# Original');
    const created = await service.createAlius({ source: target, notebookPath: '' });
    const baseline = await service.readNote(created.path);
    expect(baseline).toBe('# Original');
    // The original changed outside the app after it was opened.
    await writeFile(target, '# Changed outside');
    await expect(service.saveNote(created.path, '# Mine', baseline)).rejects.toThrow(
      'Note changed on disk. Resolve the conflict before saving.',
    );
    expect(await readFile(target, 'utf8')).toBe('# Changed outside');
    // Saving against the current baseline succeeds (Save anyway).
    await service.saveNote(created.path, '# Mine', '# Changed outside');
    expect(await readFile(target, 'utf8')).toBe('# Mine');
  });
});
