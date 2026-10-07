// @vitest-environment node
import { mkdtemp, mkdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createVaultService } from '../../electron/vault/service';

const directories: string[] = [];
const services: ReturnType<typeof createVaultService>[] = [];

async function folder() {
  const directory = await mkdtemp(path.join(process.cwd(), '.search-test-'));
  directories.push(directory);
  return directory;
}

async function open(root: string) {
  const service = createVaultService(root);
  services.push(service);
  await service.initialize();
  return service;
}

function storedZip(entries: Record<string, string>) {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, value] of Object.entries(entries)) {
    const filename = Buffer.from(name);
    const content = Buffer.from(value);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6);
    header.writeUInt32LE(crc32(content), 14);
    header.writeUInt32LE(content.length, 18);
    header.writeUInt32LE(content.length, 22);
    header.writeUInt16LE(filename.length, 26);
    local.push(header, filename, content);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(0x800, 8);
    record.writeUInt32LE(crc32(content), 16);
    record.writeUInt32LE(content.length, 20);
    record.writeUInt32LE(content.length, 24);
    record.writeUInt16LE(filename.length, 28);
    record.writeUInt32LE(offset, 42);
    central.push(record, filename);
    offset += header.length + filename.length + content.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

function crc32(buffer: Buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.dispose()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('persistent vault search', () => {
  it('searches Markdown and applies notebook, kind, tag, date, and limit filters', async () => {
    const root = await folder();
    await mkdir(path.join(root, 'Work', 'Deep'), { recursive: true });
    await writeFile(
      path.join(root, 'Work', 'Deep', 'first.md'),
      '---\ntags: [research, "access"]\n---\n# Accessible ideas\n\nA useful #inclusive design.',
    );
    await writeFile(path.join(root, 'second.md'), '# Design\n\nAccessible design.');
    await writeFile(path.join(root, 'Work', 'reference.txt'), 'Accessible design text');
    const service = await open(root);
    const results = await service.search({
      text: 'accessible design',
      notebook: 'Work',
      kind: 'note',
      tag: '#research',
    });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      path: 'Work/Deep/first.md',
      title: 'Accessible ideas',
      notebook: 'Work/Deep',
      kind: 'note',
      tags: ['access', 'inclusive', 'research'],
    });
    expect(results[0].snippet).toContain('useful');
    expect(results[0].score).toBeGreaterThan(0);
    expect(await service.search({ text: 'accessible', limit: 1 })).toHaveLength(1);
    expect(await service.search({ text: '', kind: 'attachment' })).toHaveLength(1);
    expect(await service.search({ text: '', notebook: '' })).toHaveLength(1);
    expect(await service.search({ text: '', modifiedBefore: '2000-01-01' })).toEqual([]);
    expect(await service.search({ text: '', modifiedAfter: '2099-01-01' })).toEqual([]);
    expect(await service.search({ text: 'ccess' })).toHaveLength(3);
    expect(await service.search({ text: 'unmatched' })).toEqual([]);
    expect(await service.search({ text: '', modifiedAfter: '2000-01-01', modifiedBefore: '2099-01-01' })).toHaveLength(
      3,
    );
  });

  it('indexes HTML notes by their text as note results', async () => {
    const service = await open(await folder());
    await service.createNote('briefing.html', '<h1>Briefing</h1><p>Accessible research finding</p>');
    const results = await service.search({ text: 'research finding', kind: 'note' });
    expect(results).toMatchObject([{ path: 'briefing.html', title: 'Briefing', kind: 'note' }]);
  });

  it('indexes bounded text extracted from valid PDF and ePub attachments', async () => {
    const root = await folder();
    await writeFile(path.join(root, 'guide.pdf'), '%PDF-1.7\n(needlepdfsearchtoken) Tj');
    await writeFile(
      path.join(root, 'guide.epub'),
      storedZip({
        'META-INF/container.xml': '<container><rootfile full-path="OPS/book.opf"/></container>',
        'OPS/book.opf':
          '<package><manifest><item id="chapter" href="chapter.xhtml"/></manifest><spine><itemref idref="chapter"/></spine></package>',
        'OPS/chapter.xhtml': '<html><body><p>needleepubsearchtoken</p></body></html>',
      }),
    );
    const service = await open(root);
    expect(await service.search({ text: 'needlepdfsearchtoken' })).toMatchObject([
      { path: 'guide.pdf', kind: 'attachment' },
    ]);
    expect(await service.search({ text: 'needleepubsearchtoken' })).toMatchObject([
      { path: 'guide.epub', kind: 'attachment' },
    ]);
  });

  it('indexes bounded DOCX paragraph and table text as a docx result', async () => {
    const root = await folder();
    await writeFile(
      path.join(root, 'manual.docx'),
      storedZip({
        '[Content_Types].xml':
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
        '_rels/.rels':
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="doc" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
        'word/document.xml':
          '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>needleDocxParagraph</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>needleDocxTable</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>',
      }),
    );
    const service = await open(root);
    expect(await service.search({ text: 'needleDocxParagraph', kind: 'docx' })).toMatchObject([
      { path: 'manual.docx', kind: 'docx' },
    ]);
    expect(await service.search({ text: 'needleDocxTable', kind: 'docx' })).toMatchObject([
      { path: 'manual.docx', kind: 'docx' },
    ]);
    expect(await service.readDocxStructure('manual.docx')).toMatchObject({
      blocks: [{ kind: 'paragraph', text: 'needleDocxParagraph' }, { kind: 'table' }],
    });
  });

  it('extracts txt, csv, and HTML without script/style text, and only filenames for unsupported files', async () => {
    const root = await folder();
    await writeFile(path.join(root, 'data.csv'), 'subject,value\naccessible,42');
    await writeFile(path.join(root, 'plain.txt'), 'Accessible plain text');
    await writeFile(
      path.join(root, 'page.html'),
      '<script>invisibleSecret</script><style>invisibleSecret</style><p>Accessible &amp; &#100;esign</p>',
    );
    await writeFile(path.join(root, 'manual.pdf'), 'invisibleSecret');
    await writeFile(path.join(root, 'binary.txt'), 'invisibleSecret\0binary');
    const service = await open(root);
    expect(await service.search({ text: 'accessible' })).toHaveLength(3);
    expect(await service.search({ text: 'invisibleSecret' })).toEqual([]);
    expect((await service.search({ text: 'design' }))[0].snippet).toBe('Accessible & design');
    expect((await service.search({ text: 'manual' }))[0]).toMatchObject({ path: 'manual.pdf', snippet: '' });
  });

  it('indexes task toggles, creates, saves, and folder renames immediately', async () => {
    const service = await open(await folder());
    await service.createFolder('Work');
    await service.createNote('Work/Note.md');
    await service.saveNote('Work/Note.md', '# Original\n\n- [ ] unique-task');
    expect(await service.search({ text: 'unique-task' })).toHaveLength(1);
    await service.toggleTask('Work/Note.md', 3, true);
    expect((await service.search({ text: 'unique-task' }))[0].snippet).toContain('[x]');
    await service.toggleBookmark('Work/Note.md');
    await service.renameEntry('Work', 'Archive');
    expect((await service.search({ text: 'unique-task' }))[0].path).toBe('Archive/Note.md');
    expect((await service.getBookmarks())[0].path).toBe('Archive/Note.md');
    await service.saveNote('Archive/Note.md', '# Replacement');
    expect(await service.search({ text: 'unique-task' })).toEqual([]);
    expect((await service.search({ text: 'replacement' }))[0].title).toBe('Replacement');
    await expect(service.readNote('../outside.md')).rejects.toThrow();
    await expect(service.saveNote('wrong.txt', 'text')).rejects.toThrow();
    expect((await service.getVault()).entries[0].name).toBe('Archive');
  });

  it('persists a versioned atomic cache and verifies startup freshness including deletion and additions', async () => {
    const root = await folder();
    await writeFile(path.join(root, 'old.md'), '# Old text');
    await writeFile(path.join(root, 'gone.md'), 'deleted token');
    const first = await open(root);
    await first.dispose();
    const cache = JSON.parse(await readFile(path.join(root, '.a11ynotebook', 'search-index.json'), 'utf8'));
    expect(cache.version).toBe(4);
    expect(cache.root).toBe(root);
    await writeFile(path.join(root, 'old.md'), '# Fresh text');
    await rm(path.join(root, 'gone.md'));
    await writeFile(path.join(root, 'added.txt'), 'brand new');
    const second = await open(root);
    expect(await second.search({ text: 'old' })).toHaveLength(1); // Filename still matches.
    expect((await second.search({ text: 'fresh' }))[0].title).toBe('Fresh text');
    expect(await second.search({ text: 'deleted' })).toEqual([]);
    expect(await second.search({ text: 'brand' })).toHaveLength(1);
    expect((await second.getVault()).entries.some((entry) => entry.name === '.a11ynotebook')).toBe(false);
  });

  it('rebuilds corrupt, incompatible, or structurally invalid caches', async () => {
    const root = await folder();
    const service = await open(root);
    await service.createNote('Note.md');
    await service.dispose();
    const cachePath = path.join(root, '.a11ynotebook', 'search-index.json');
    for (const contents of [
      'broken json',
      '{"version":999}',
      JSON.stringify({ version: 1, root, documents: [{ path: '../escape' }] }),
    ]) {
      await writeFile(cachePath, contents);
      const next = await open(root);
      expect(await next.search({ text: 'Note' })).toHaveLength(1);
      await next.dispose();
    }
  });

  it('serializes concurrent index updates without partial JSON or stale results', async () => {
    const root = await folder();
    const service = await open(root);
    await Promise.all(Array.from({ length: 12 }, (_, index) => service.createNote(`Note-${index}.md`)));
    await Promise.all(
      Array.from({ length: 12 }, (_, index) => service.saveNote(`Note-${index}.md`, `# Content-${index}`)),
    );
    expect(await service.search({ text: 'content' })).toHaveLength(12);
    const cache = JSON.parse(await readFile(path.join(root, '.a11ynotebook', 'search-index.json'), 'utf8'));
    expect(cache.documents).toHaveLength(12);
    await service.dispose();
    await expect(service.search({ text: '' })).rejects.toThrow('Open a vault');
  });

  it('rejects invalid renderer query objects and paths before searching', async () => {
    const service = await open(await folder());
    for (const query of [
      null,
      {},
      { text: 1 },
      { text: 'a'.repeat(1001) },
      { text: '', limit: 0 },
      { text: '', limit: 201 },
      { text: '', limit: 1.5 },
      { text: '', kind: 'pdf' },
      { text: '', notebook: '../outside' },
      { text: '', notebook: 'C:\\outside' },
      { text: '', notebook: '.a11ynotebook' },
      { text: '', tag: [] },
      { text: '', modifiedAfter: 'nonsense' },
      { text: '', modifiedAfter: '2099-01-01', modifiedBefore: '2000-01-01' },
    ]) {
      await expect(service.search(query as never)).rejects.toThrow();
    }
    await expect(service.readNote('C:\\outside.md')).rejects.toThrow();
  });

  it('ignores hidden files, hidden directories, and metadata', async () => {
    const root = await folder();
    await mkdir(path.join(root, '.hidden'));
    await writeFile(path.join(root, '.hidden', 'secret.md'), 'hiddenSecret');
    await writeFile(path.join(root, '.secret.md'), 'hiddenSecret');
    const service = await open(root);
    await writeFile(path.join(root, '.a11ynotebook', 'private.txt'), 'hiddenSecret');
    await service.refreshSearchIndex();
    expect(await service.search({ text: 'hiddenSecret' })).toEqual([]);
  });

  it.skipIf(process.platform === 'win32')(
    'rejects symlinked metadata folders and files instead of accessing outside data',
    async () => {
      const root = await folder();
      const outside = await folder();
      await symlink(outside, path.join(root, '.a11ynotebook'), 'dir');
      await expect(open(root)).rejects.toThrow('Symbolic links');
      await rm(path.join(root, '.a11ynotebook'));
      const service = await open(root);
      await rm(path.join(root, '.a11ynotebook', 'search-index.json'));
      await writeFile(path.join(outside, 'index.json'), '{}');
      await symlink(path.join(outside, 'index.json'), path.join(root, '.a11ynotebook', 'search-index.json'));
      await expect(service.refreshSearchIndex()).rejects.toThrow('Symbolic links');
      expect(await readFile(path.join(outside, 'index.json'), 'utf8')).toBe('{}');
      await symlink(path.join(outside, 'index.json'), path.join(root, '.a11ynotebook', 'bookmarks.json'));
      await expect(service.getBookmarks()).rejects.toThrow('Symbolic links');
      await symlink(path.join(outside, 'index.json'), path.join(root, '.a11ynotebook', 'links.json'));
      await expect(service.getLinkIndex()).rejects.toThrow('Symbolic links');
    },
  );

  it.skipIf(process.platform === 'win32')(
    'never indexes symlinked files or folders, including replacements on refresh',
    async () => {
      const root = await folder();
      const outside = await folder();
      await writeFile(path.join(outside, 'secret.md'), 'externalSecret');
      await writeFile(path.join(root, 'real.md'), 'original');
      await symlink(outside, path.join(root, 'escape'), 'dir');
      await symlink(path.join(outside, 'secret.md'), path.join(root, 'secret.md'));
      const service = await open(root);
      expect(await service.search({ text: 'externalSecret' })).toEqual([]);
      await rm(path.join(root, 'real.md'));
      await symlink(path.join(outside, 'secret.md'), path.join(root, 'real.md'));
      await service.refreshSearchIndex();
      expect(await service.search({ text: 'original' })).toEqual([]);
      await expect(service.readNote('real.md')).rejects.toThrow('Symbolic links');
    },
  );

  it('refreshes external directory renames and deletions', async () => {
    const root = await folder();
    await mkdir(path.join(root, 'Before'));
    await writeFile(path.join(root, 'Before', 'Note.md'), 'rename token');
    const service = await open(root);
    await rename(path.join(root, 'Before'), path.join(root, 'After'));
    await service.refreshSearchIndex();
    expect((await service.search({ text: 'token' }))[0].path).toBe('After/Note.md');
    await rm(path.join(root, 'After'), { recursive: true });
    await service.refreshSearchIndex();
    expect(await service.search({ text: 'token' })).toEqual([]);
  });

  it('moves notes and folders across notebooks while migrating bookmarks and search paths', async () => {
    const service = await open(await folder());
    await service.createFolder('Source');
    await service.createFolder('Destination');
    await service.createFolder('Source/Nested');
    await service.createNote('Source/Nested/Note.md');
    await service.saveNote('Source/Nested/Note.md', '# Move token');
    await service.toggleBookmark('Source/Nested/Note.md');
    await service.moveEntry('Source/Nested', 'Destination/Moved');
    expect((await service.search({ text: 'token' }))[0].path).toBe('Destination/Moved/Note.md');
    expect((await service.getBookmarks())[0].path).toBe('Destination/Moved/Note.md');
    await service.moveEntry('Destination/Moved/Note.md', 'Source/Renamed.md');
    expect((await service.getBookmarks())[0]).toMatchObject({ path: 'Source/Renamed.md', title: 'Renamed' });
    expect((await service.search({ text: 'token' }))[0].path).toBe('Source/Renamed.md');
    await expect(service.moveEntry('Source', 'Source/Inside')).rejects.toThrow('inside itself');
    await expect(service.moveEntry('Source/Renamed.md', 'Source/Renamed.md')).rejects.toThrow('already exists');
    await expect(service.moveEntry('Source/Renamed.md', '../outside.md')).rejects.toThrow();
    await expect(service.moveEntry('Source/Renamed.md', '.a11ynotebook/inside.md')).rejects.toThrow();
    await expect(service.moveEntry('Source/Renamed.md', 'Missing/inside.md')).rejects.toThrow();
  });

  it('resolves metadata leaves only, honors allowMissing, and rejects traversal or absolute names', async () => {
    const root = await folder();
    const service = await open(root);
    const expected = path.join(root, '.a11ynotebook', 'annotations.json');
    expect(await service.resolveMetadata('annotations.json', true)).toBe(expected);
    await expect(service.resolveMetadata('annotations.json')).rejects.toThrow();
    await writeFile(expected, '{}');
    expect(await service.resolveMetadata('annotations.json')).toBe(expected);
    for (const name of [
      '',
      '.',
      '..',
      '../outside.json',
      'nested/file.json',
      'nested\\file.json',
      '/outside.json',
      'C:\\outside.json',
      'file:stream',
      'bad\0file',
    ]) {
      await expect(service.resolveMetadata(name, true)).rejects.toThrow('valid metadata filename');
    }
  });

  it.skipIf(process.platform === 'win32')('rejects replaced metadata roots and symlink move destinations', async () => {
    const root = await folder();
    const outside = await folder();
    const service = await open(root);
    await service.createNote('Note.md');
    await symlink(outside, path.join(root, 'Destination'), 'dir');
    await expect(service.moveEntry('Note.md', 'Destination/Note.md')).rejects.toThrow('Symbolic links');
    await rm(path.join(root, '.a11ynotebook'), { recursive: true });
    await symlink(outside, path.join(root, '.a11ynotebook'), 'dir');
    await expect(service.resolveMetadata('annotations.json', true)).rejects.toThrow('Symbolic links');
    await expect(service.refreshSearchIndex()).rejects.toThrow('Symbolic links');
  });

  it('checks the expected disk baseline before saving and leaves conflicting content untouched', async () => {
    const root = await folder();
    const service = await open(root);
    await service.createNote('Note.md');
    const original = await service.readNote('Note.md');
    await service.saveNote('Note.md', '# Saved', original);
    expect(await service.readNote('Note.md')).toBe('# Saved');
    await writeFile(path.join(root, 'Note.md'), '# External edit');
    await expect(service.saveNote('Note.md', '# Unsaved draft', '# Saved')).rejects.toThrow(
      'Note changed on disk. Resolve the conflict before saving.',
    );
    expect(await service.readNote('Note.md')).toBe('# External edit');
    await service.saveNote('Note.md', '# Resolved', '# External edit');
    expect((await service.search({ text: 'resolved' }))[0].title).toBe('Resolved');
    await expect(service.saveNote('Note.md', '# Invalid', 1 as never)).rejects.toThrow(
      'Expected note content must be text.',
    );
    await rm(path.join(root, 'Note.md'));
    await expect(service.saveNote('Note.md', '# Deleted draft', '# Resolved')).rejects.toThrow(
      'Note changed on disk. Resolve the conflict before saving.',
    );
  });

  it('serializes competing app saves so only one matching baseline can succeed', async () => {
    const service = await open(await folder());
    await service.createNote('Note.md');
    const baseline = await service.readNote('Note.md');
    const results = await Promise.allSettled([
      service.saveNote('Note.md', '# First edit', baseline),
      service.saveNote('Note.md', '# Second edit', baseline),
    ]);
    expect(results[0].status).toBe('fulfilled');
    expect(results[1]).toMatchObject({
      status: 'rejected',
      reason: new Error('Note changed on disk. Resolve the conflict before saving.'),
    });
    expect(await service.readNote('Note.md')).toBe('# First edit');
    await service.saveNote('Note.md', '# Retry', '# First edit');
    expect(await service.readNote('Note.md')).toBe('# Retry');
  });

  it('serializes task toggles with app saves without silently overwriting checkbox changes', async () => {
    const service = await open(await folder());
    await service.createNote('Note.md');
    const baseline = '# Tasks\n\n- [ ] First\n- [ ] Second';
    await service.saveNote('Note.md', baseline);
    const results = await Promise.allSettled([
      service.toggleTask('Note.md', 3, true),
      service.toggleTask('Note.md', 4, true),
      service.saveNote('Note.md', '# Stale draft', baseline),
    ]);
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled', 'rejected']);
    expect(await service.readNote('Note.md')).toBe('# Tasks\n\n- [x] First\n- [x] Second');
  });

  it('creates template and conflict-copy notes with validated optional content and exclusive creation', async () => {
    const service = await open(await folder());
    await service.createNote('Default.md');
    expect(await service.readNote('Default.md')).toBe('# Default\n\n');
    await service.createNote('Template.md', '# Meeting template\n\nAgenda');
    expect(await service.readNote('Template.md')).toBe('# Meeting template\n\nAgenda');
    expect((await service.search({ text: 'agenda' }))[0].path).toBe('Template.md');
    await service.createNote('Empty.md', '');
    expect(await service.readNote('Empty.md')).toBe('');
    await expect(service.createNote('Invalid.md', 1 as never)).rejects.toThrow('Note content must be text.');
    await expect(service.readNote('Invalid.md')).rejects.toThrow();
    const results = await Promise.allSettled([
      service.createNote('Conflict copy.md', '# Unsaved draft'),
      service.createNote('Conflict copy.md', '# Competing draft'),
    ]);
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected']);
    expect(await service.readNote('Conflict copy.md')).toBe('# Unsaved draft');
  });

  it('returns sorted unique tag facets across all indexed documents without a search result cap', async () => {
    const root = await folder();
    await Promise.all(
      Array.from({ length: 225 }, (_, index) =>
        writeFile(path.join(root, `${index}.md`), `# Note\n\n#tag-${String(index).padStart(3, '0')} #shared`),
      ),
    );
    const service = await open(root);
    expect(await service.search({ text: '', limit: 200 })).toHaveLength(200);
    const tags = await service.getTags();
    expect(tags).toHaveLength(226);
    expect(tags[0]).toBe('shared');
    expect(tags.at(-1)).toBe('tag-224');
    await service.saveNote('0.md', '# Replaced\n\n#new-tag');
    expect(await service.getTags()).not.toContain('tag-000');
    expect(await service.getTags()).toContain('new-tag');
    await service.dispose();
    await expect(service.getTags()).rejects.toThrow('Open a vault first.');
  });
});
