// @vitest-environment node
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createVaultService } from '../../electron/vault/service';
import { buildVaultLinkIndex, parseMarkdownLinks } from '../../electron/vault/links';
import type { VaultEntry } from '../shared/types';

let temporaryDirectory = '';

afterEach(async () => {
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
});

describe('Markdown links', () => {
  it('parses wiki links and local Markdown links but ignores web links', () => {
    expect(
      parseMarkdownLinks(
        '[[Target note|label]] [Local](./Target.md) [Web](https://example.com)\n\n`[[inline]]`\n```md\n[[example]]\n```',
      ),
    ).toEqual([
      { target: 'Target note', isWiki: true },
      { target: './Target.md', isWiki: false },
    ]);
  });

  it('builds resolved backlinks and marks missing notes', () => {
    const entries: VaultEntry[] = [
      {
        name: 'Folder',
        path: 'Folder',
        kind: 'notebook',
        children: [
          { name: 'Start.md', path: 'Folder/Start.md', kind: 'note' },
          { name: 'Target.md', path: 'Folder/Target.md', kind: 'note' },
        ],
      },
    ];
    expect(
      buildVaultLinkIndex([{ path: 'Folder/Start.md', content: '[[Target]] [Missing](./No.md)' }], entries).links,
    ).toEqual([
      {
        sourcePath: 'Folder/Start.md',
        targetPath: 'Folder/Target.md',
        targetTitle: 'Target',
        resolved: true,
        attachment: false,
      },
      {
        sourcePath: 'Folder/Start.md',
        targetTitle: 'No.md',
        resolved: false,
        attachment: false,
      },
    ]);
  });

  it('writes a readable link index and persists bookmark toggles in vault metadata', async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'a11y-link-index-'));
    const service = createVaultService(temporaryDirectory);
    await service.initialize();
    await service.createNote('Start.md');
    await service.saveNote('Start.md', '# Start\n\n[[Unresolved]]');
    await service.createNote('Existing.md');
    await expect(service.renameEntry('Start.md', 'Existing.md')).rejects.toThrow('already exists');
    await service.getLinkIndex();
    await expect(access(path.join(temporaryDirectory, '.a11ynotebook', 'links.json'))).resolves.toBeUndefined();
    expect(
      JSON.parse(await readFile(path.join(temporaryDirectory, '.a11ynotebook', 'links.json'), 'utf8')).links[0],
    ).toMatchObject({ targetTitle: 'Unresolved', resolved: false });
    expect(await service.toggleBookmark('Start.md')).toMatchObject([{ path: 'Start.md', title: 'Start' }]);
    expect(await service.getBookmarks()).toHaveLength(1);
    await service.renameEntry('Start.md', 'Renamed.md');
    expect(await service.getBookmarks()).toMatchObject([{ path: 'Renamed.md', title: 'Renamed' }]);
    expect(await service.toggleBookmark('Renamed.md')).toEqual([]);
    await service.toggleBookmark('Renamed.md');
    await rm(path.join(temporaryDirectory, 'Renamed.md'));
    expect(await service.getBookmarks()).toEqual([]);
  });
});
