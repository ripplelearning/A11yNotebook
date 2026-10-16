// @vitest-environment node
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createVaultService } from '../../electron/vault/service';
import { createMetadataStore } from '../../electron/vault/metadata';
import { createAssetStore } from '../../electron/vault/assets';
import { createLocalLibrary } from '../../electron/vault/create-library';
import { importedCopyPath, readImportSource } from '../../electron/vault/import';
import { untaggedReport } from './fixtures/pdf-fixtures';

const mock = vi.hoisted(() => ({
  unsupportedLinks: false,
  protectedPdf: '',
  failProvenanceWrite: false,
  failReplacementRename: false,
}));
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', async (original) => {
  const actual = await original<typeof import('pdfjs-dist/legacy/build/pdf.mjs')>();
  return {
    ...actual,
    getDocument: (...args: Parameters<typeof actual.getDocument>) => {
      if (!mock.protectedPdf) return actual.getDocument(...args);
      return {
        promise:
          mock.protectedPdf === 'password'
            ? Promise.reject(Object.assign(new Error('Password required'), { name: 'PasswordException' }))
            : Promise.resolve({ getPermissions: async () => [4] }),
        destroy: async () => undefined,
      };
    },
  };
});
vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>();
  return {
    ...actual,
    link: async (...args: Parameters<typeof actual.link>) => {
      if (mock.unsupportedLinks) throw Object.assign(new Error('Hard links unsupported'), { code: 'ENOTSUP' });
      return actual.link(...args);
    },
    rename: async (...args: Parameters<typeof actual.rename>) => {
      if (mock.failProvenanceWrite && path.basename(String(args[1])) === 'provenance.json')
        throw new Error('Origin metadata write failed');
      if (mock.failReplacementRename && path.basename(String(args[1])) === 'Original.md')
        throw new Error('Filesystem replacement failed');
      return actual.rename(...args);
    },
  };
});

let root = '';
const services: ReturnType<typeof createVaultService>[] = [];
beforeEach(async () => {
  mock.unsupportedLinks = false;
  mock.protectedPdf = '';
  mock.failProvenanceWrite = false;
  mock.failReplacementRename = false;
  root = path.resolve(`.test-workflows-${randomUUID()}`);
  await mkdir(root);
});
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.dispose()));
  await rm(root, { recursive: true, force: true });
});
async function vault() {
  const service = createVaultService(root);
  services.push(service);
  await service.initialize();
  return service;
}

describe('document provenance and original imports', () => {
  it('suffixes original and specialized asset names without changing their format', () => {
    expect(importedCopyPath('Folder/Original.md', 0)).toBe('Folder/Original.md');
    expect(importedCopyPath('Folder/Original.md', 1)).toBe('Folder/Original (imported).md');
    expect(importedCopyPath('Folder/Original.outline.md', 2)).toBe('Folder/Original (imported 2).outline.md');
    expect(importedCopyPath('Original.MINDMAP.JSON', 1)).toBe('Original (imported).MINDMAP.JSON');
  });

  it('refuses encrypted and malformed encrypted-note envelopes rather than marking them editable', async () => {
    const source = path.join(root, 'Encrypted.md');
    for (const text of [
      '{"format":"a11ynotebook-encrypted-v1","id":"legacy","ciphertext":"private"}',
      '{"format":"a11ynotebook-password-note-v1","id":"protected","ciphertext":"private"}',
      '{"format":"a11ynotebook-encrypted-v1",',
    ]) {
      await writeFile(source, text);
      await expect(readImportSource(source)).rejects.toThrow('explicitly export an authorized plaintext copy');
      expect(await readFile(source, 'utf8')).toBe(text);
    }
  });

  it('validates genuine PDF structure and refuses password or permission protected originals', async () => {
    const source = path.join(root, 'Original.pdf');
    const bytes = Buffer.from(untaggedReport(1));
    await writeFile(source, bytes);
    expect(await readImportSource(source)).toEqual(bytes);
    for (const protectedPdf of ['password', 'permissions']) {
      mock.protectedPdf = protectedPdf;
      await expect(readImportSource(source)).rejects.toThrow(/protected|Protected/);
    }
    mock.protectedPdf = '';
    await writeFile(source, '%PDF-1.7\nNot a real document');
    await expect(readImportSource(source)).rejects.toThrow();
  });

  it('rejects hidden created/imported names instead of creating invisible library items', async () => {
    const service = await vault();
    await expect(service.createNote('.Hidden.md')).rejects.toThrow('hidden names');
    await expect(service.createNote('.Hidden/Note.md')).rejects.toThrow('hidden names');
    await expect(service.createFolder('.Hidden')).rejects.toThrow('hidden names');
    await expect(service.createDocument('.Imported.html', '<h1>Original</h1>', 'imported')).rejects.toThrow(
      'hidden names',
    );
    expect(await readdir(root)).toEqual(['.a11ynotebook']);
    await service.createNote('Visible.md');
    await expect(service.renameEntry('Visible.md', '.Hidden.md')).rejects.toThrow('hidden names');
    await expect(service.moveEntry('Visible.md', '.Hidden.md')).rejects.toThrow('hidden names');
  });

  it('supports writable library filesystems without hard links while retaining exclusive creation', async () => {
    const service = await vault();
    mock.unsupportedLinks = true;
    await service.createNote('Created.md', '# Authored');
    await service.createDocument('Original.md', '# Imported', 'imported');
    expect((await service.getVault()).entries.map((entry) => entry.provenance)).toEqual(['created', 'imported']);
    await expect(service.createDocument('Original.md', '# Replacement', 'imported')).rejects.toThrow();
    expect(await service.readNote('Original.md')).toBe('# Imported');
  });

  it('keeps legacy files unknown and persists authored/imported origin without changing original bytes', async () => {
    await writeFile(path.join(root, 'Legacy.md'), '# Legacy');
    const service = await vault();
    const bytes = Buffer.from('<h1>Original</h1>\r\n<script>original bytes retained</script>');
    await service.createNote('Created.md', '# Authored');
    await service.createDocument('Original.html', bytes, 'imported');
    await service.saveNote('Legacy.md', '# Legacy edited without claiming origin');
    expect(await readFile(path.join(root, 'Original.html'))).toEqual(bytes);
    await writeFile(path.join(root, 'Created.md'), '# External in-place change');
    await writeFile(path.join(root, 'Original.html'), '<h1>External in-place change</h1>');
    expect((await service.getVault()).entries.find((entry) => entry.path === 'Original.html')?.provenance).toBe(
      'imported',
    );
    await service.saveNote('Original.html', '<h1>Edited</h1>');
    const entries = (await service.getVault()).entries;
    expect(entries.find((entry) => entry.path === 'Legacy.md')?.provenance).toBeUndefined();
    expect(entries.find((entry) => entry.path === 'Created.md')?.provenance).toBe('created');
    expect(entries.find((entry) => entry.path === 'Original.html')?.provenance).toBe('imported');
    const metadata = await readFile(path.join(root, '.a11ynotebook', 'provenance.json'), 'utf8');
    expect(metadata).not.toMatch(/Original|Created|Legacy|script|Authored/);
    const reopened = await vault();
    expect((await reopened.getVault()).entries.find((entry) => entry.path === 'Original.html')?.provenance).toBe(
      'imported',
    );
  });

  it('retires replaced identities and prunes deleted and abandoned records without inferring file origin', async () => {
    const service = await vault();
    const filename = path.join(root, '.a11ynotebook', 'provenance.json');
    await service.createNote('Created.md', '# Authored');
    for (let attempt = 0; attempt < 5; attempt += 1) await service.saveNote('Created.md', `# Authored ${attempt}`);
    let envelope = JSON.parse(await readFile(filename, 'utf8')) as { version: number; records: Record<string, string> };
    expect(Object.keys(envelope.records)).toHaveLength(1);
    await rm(path.join(root, 'Created.md'));
    await writeFile(path.join(root, 'Unknown.md'), '# Untracked original');
    await service.pruneProvenance();
    envelope = JSON.parse(await readFile(filename, 'utf8')) as typeof envelope;
    expect(envelope.records).toEqual({});
    expect((await service.getVault()).entries[0].provenance).toBeUndefined();
    for (let index = 0; index < 1024; index += 1)
      envelope.records[createHash('sha256').update(`abandoned-${index}`).digest('hex')] = 'imported';
    await writeFile(filename, JSON.stringify(envelope));
    await service.createNote('Next.md', '# Authored');
    envelope = JSON.parse(await readFile(filename, 'utf8')) as typeof envelope;
    expect(Object.keys(envelope.records)).toHaveLength(1);
    expect((await service.getVault()).entries.find((entry) => entry.path === 'Unknown.md')?.provenance).toBeUndefined();
  });

  it('rolls back creation and leaves imported bytes/origin unchanged when metadata persistence fails', async () => {
    const service = await vault();
    mock.failProvenanceWrite = true;
    await expect(service.createNote('Failed.md')).rejects.toThrow('Origin metadata write failed');
    expect(await readdir(root)).not.toContain('Failed.md');
    mock.failProvenanceWrite = false;
    await service.createDocument('Original.md', '# Imported original', 'imported');
    const filename = path.join(root, '.a11ynotebook', 'provenance.json');
    const before = await readFile(filename, 'utf8');
    mock.failProvenanceWrite = true;
    await expect(service.saveNote('Original.md', '# Not committed')).rejects.toThrow('Origin metadata write failed');
    expect(await service.readNote('Original.md')).toBe('# Imported original');
    expect((await service.getVault()).entries[0].provenance).toBe('imported');
    expect(await readFile(filename, 'utf8')).toBe(before);
    expect((await readdir(root)).some((entry) => entry.endsWith('.tmp'))).toBe(false);
  });

  it('retains original origin when replacement or authorization fails after staging metadata commits', async () => {
    const service = await vault();
    await service.createDocument('Original.md', '# Imported original', 'imported');
    mock.failReplacementRename = true;
    await expect(service.saveNote('Original.md', '# Not committed')).rejects.toThrow('Filesystem replacement failed');
    expect(await service.readNote('Original.md')).toBe('# Imported original');
    expect((await service.getVault()).entries[0].provenance).toBe('imported');
    mock.failReplacementRename = false;
    let checks = 0;
    await expect(
      service.saveNote('Original.md', '# Not authorized', undefined, () => {
        // The metadata writer checks after its own atomic rename, before the note
        // replacement can commit. Revocation must retain the old identity record.
        if (++checks >= 4) throw new Error('Authorization revoked');
      }),
    ).rejects.toThrow('Authorization revoked');
    expect(await service.readNote('Original.md')).toBe('# Imported original');
    expect((await service.getVault()).entries[0].provenance).toBe('imported');
    await service.pruneProvenance();
    const records = JSON.parse(await readFile(path.join(root, '.a11ynotebook', 'provenance.json'), 'utf8')).records;
    expect(Object.keys(records)).toHaveLength(1);
  });

  it('survives folder move/rename and rollback, while replacement/deletion never inherits origin', async () => {
    const service = await vault();
    await service.createFolder('Folder');
    await service.createNote('Folder/Created.md', '# Authored');
    await service.createDocument('Folder/Imported.md', '# Original', 'imported');
    await service.renameEntry('Folder', 'Renamed');
    expect((await service.getVault()).entries[0].children?.map((entry) => entry.provenance)).toEqual([
      'created',
      'imported',
    ]);
    await service.moveEntry('Renamed', 'Folder');
    await service.saveNote('Folder/Imported.md', '# Repaired link');
    expect((await service.getVault()).entries[0].children?.[1].provenance).toBe('imported');
    await writeFile(path.join(root, 'replacement.md'), '# External replacement');
    await rename(path.join(root, 'replacement.md'), path.join(root, 'Folder', 'Created.md'));
    await rm(path.join(root, 'Folder', 'Imported.md'));
    await writeFile(path.join(root, 'Folder', 'Imported.md'), '# Untracked successor');
    expect((await service.getVault()).entries[0].children?.map((entry) => entry.provenance)).toEqual([
      undefined,
      undefined,
    ]);
  });

  it('preserves cognitive asset origin through atomic saves and unknown assets remain unknown', async () => {
    const service = await vault();
    const store = createAssetStore(service, createMetadataStore(service));
    await store.create('Plan.outline.md', '- First');
    await store.save('Plan.outline.md', '- Second', '- First');
    expect((await service.getVault()).entries[0].provenance).toBe('created');
    await service.createDocument('Original.outline.md', '- First', 'imported');
    await store.save('Original.outline.md', '- Second', '- First');
    expect((await service.getVault()).entries.find((entry) => entry.path.startsWith('Original'))?.provenance).toBe(
      'imported',
    );
  });

  it('does not overwrite existing files and rolls back creation on revoked authorization', async () => {
    const service = await vault();
    await service.createNote('Existing.md', '# Existing');
    await expect(service.createDocument('Existing.md', '# Replacement', 'imported')).rejects.toThrow();
    expect(await service.readNote('Existing.md')).toBe('# Existing');
    let checks = 0;
    await expect(
      service.createDocument('Cancelled.md', '# Data', 'imported', () => {
        if (++checks >= 3) throw new Error('Locked');
      }),
    ).rejects.toThrow('Locked');
    expect(await readdir(root)).not.toContain('Cancelled.md');
    expect((await readdir(root)).some((name) => name.endsWith('.tmp'))).toBe(false);
  });

  it('treats malformed, unsupported-version, and forged unvalidated provenance as unknown', async () => {
    const service = await vault();
    await service.createNote('Created.md');
    const filename = path.join(root, '.a11ynotebook', 'provenance.json');
    for (const data of [
      '{broken',
      '{"version":2,"records":{}}',
      '{"version":1,"records":{"../Created.md":"created"}}',
    ]) {
      await writeFile(filename, data);
      expect((await service.getVault()).entries[0].provenance).toBeUndefined();
      await expect(service.createNote('Blocked.md')).rejects.toThrow('could not be safely read');
      expect(await readFile(filename, 'utf8')).toBe(data);
    }
  });

  it('never overwrites valid overlimit origin metadata or loses original bytes during mutation', async () => {
    const service = await vault();
    await service.createDocument('Original.md', '# Imported original', 'imported');
    const filename = path.join(root, '.a11ynotebook', 'provenance.json');
    const envelope = JSON.parse(await readFile(filename, 'utf8')) as {
      version: number;
      records: Record<string, string>;
    };
    for (let index = 0; index < 100_000; index += 1)
      envelope.records[index.toString(16).padStart(64, '0')] = 'imported';
    const originalMetadata = JSON.stringify(envelope);
    await writeFile(filename, originalMetadata);
    expect((await service.getVault()).entries[0].provenance).toBeUndefined();
    await expect(service.createNote('Blocked.md')).rejects.toThrow('could not be safely read');
    await expect(service.saveNote('Original.md', '# Not committed')).rejects.toThrow('could not be safely read');
    expect(await readFile(filename, 'utf8')).toBe(originalMetadata);
    expect(await service.readNote('Original.md')).toBe('# Imported original');
    expect(await readdir(root)).not.toContain('Blocked.md');
  });

  it('validates original imports, rejecting unsupported, mismatched, binary, oversized, and symlink sources', async () => {
    const source = path.join(root, 'Original.html');
    const bytes = Buffer.from('<h1>Original</h1>\r\n');
    await writeFile(source, bytes);
    expect(await readImportSource(source)).toEqual(bytes);
    await writeFile(path.join(root, 'danger.exe'), 'MZ');
    await expect(readImportSource(path.join(root, 'danger.exe'))).rejects.toThrow('supported');
    await writeFile(path.join(root, 'arbitrary.json'), '{}');
    await expect(readImportSource(path.join(root, 'arbitrary.json'))).rejects.toThrow('.mindmap.json');
    await writeFile(path.join(root, 'fake.pdf'), 'Not a PDF');
    await expect(readImportSource(path.join(root, 'fake.pdf'))).rejects.toThrow('PDF');
    await writeFile(path.join(root, 'fake.docx'), 'Not a ZIP');
    await expect(readImportSource(path.join(root, 'fake.docx'))).rejects.toThrow();
    await writeFile(path.join(root, 'fake.png'), 'Not an image');
    await expect(readImportSource(path.join(root, 'fake.png'))).rejects.toThrow('image');
    await writeFile(path.join(root, 'binary.txt'), Buffer.from([0xff, 0x00]));
    await expect(readImportSource(path.join(root, 'binary.txt'))).rejects.toThrow();
    await writeFile(path.join(root, 'large.md'), Buffer.alloc(5 * 1024 * 1024 + 1));
    await expect(readImportSource(path.join(root, 'large.md'))).rejects.toThrow('size limit');
    if (process.platform !== 'win32') {
      await symlink(source, path.join(root, 'Link.html'));
      await expect(readImportSource(path.join(root, 'Link.html'))).rejects.toThrow('regular file');
    }
  });
});

describe('new local library lifecycle', () => {
  it('creates a genuinely new initialized library and rejects existing folders without changing them', async () => {
    const destination = path.join(root, 'New library');
    const result = await createLocalLibrary(
      destination,
      async (folder) => {
        const service = createVaultService(folder);
        services.push(service);
        return service.initialize();
      },
      () => undefined,
    );
    expect(result.name).toBe('New library');
    expect(result.entries).toEqual([]);
    await expect(
      createLocalLibrary(
        destination,
        async () => undefined,
        () => undefined,
      ),
    ).rejects.toThrow();
    expect((await lstat(destination)).isDirectory()).toBe(true);
  });
  it('rolls back only its initialization files and never removes concurrently added user data', async () => {
    const destination = path.join(root, 'New library');
    await expect(
      createLocalLibrary(
        destination,
        async (folder) => {
          await mkdir(path.join(folder, '.a11ynotebook'));
          await writeFile(path.join(folder, '.a11ynotebook', 'search-index.json'), '{}');
          throw new Error('Initialization failed');
        },
        () => undefined,
      ),
    ).rejects.toThrow('Initialization failed');
    await expect(lstat(destination)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(
      createLocalLibrary(
        destination,
        async (folder) => {
          await writeFile(path.join(folder, 'User.md'), '# Keep me');
          throw new Error('Initialization failed');
        },
        () => undefined,
      ),
    ).rejects.toThrow('A folder remains');
    expect(await readFile(path.join(destination, 'User.md'), 'utf8')).toBe('# Keep me');
  });
  it('validates names and rechecks authorization before initializing', async () => {
    await expect(
      createLocalLibrary(
        path.join(root, 'CON'),
        async () => undefined,
        () => undefined,
      ),
    ).rejects.toThrow('valid name');
    await expect(
      createLocalLibrary(
        path.join(root, 'Valid'),
        async () => undefined,
        () => {
          throw new Error('Locked');
        },
      ),
    ).rejects.toThrow('Locked');
    expect(await readdir(root)).toEqual([]);
  });
});
