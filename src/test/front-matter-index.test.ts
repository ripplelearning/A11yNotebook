// @vitest-environment node
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createVaultService } from '../../electron/vault/service';

const services: ReturnType<typeof createVaultService>[] = [];
const directories: string[] = [];

async function folder() {
  const directory = await mkdtemp(path.join(process.cwd(), '.frontmatter-test-'));
  directories.push(directory);
  return directory;
}

async function open(root: string) {
  const service = createVaultService(root);
  services.push(service);
  await service.initialize();
  return service;
}

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.dispose()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('front-matter index', () => {
  it('collects field names and values across Markdown and text notes', async () => {
    const root = await folder();
    await mkdir(path.join(root, 'Work'), { recursive: true });
    await writeFile(
      path.join(root, 'Work', 'first.md'),
      '---\nStatus: draft\nauthor: Sam\ntags: [study, work]\ncount: 3\n---\n# First\n',
    );
    await writeFile(
      path.join(root, 'second.md'),
      '---\nstatus: done\nauthor: Jo\n---\n# Second\n',
    );
    await writeFile(path.join(root, 'plain.md'), '# No front matter\n');
    await writeFile(path.join(root, 'page.html'), '<h1>HTML has no front matter</h1>');
    const service = await open(root);
    expect(await service.getFrontMatterIndex()).toEqual({
      Status: ['done', 'draft'],
      author: ['Jo', 'Sam'],
      count: ['3'],
      tags: ['study', 'work'],
    });
  });

  it('skips notes with unsupported front matter instead of failing the scan', async () => {
    const root = await folder();
    await writeFile(path.join(root, 'nested.md'), '---\nauthor:\n  name: Sam\n---\n# Nested\n');
    await writeFile(path.join(root, 'ok.md'), '---\nstatus: done\n---\n# Ok\n');
    const service = await open(root);
    expect(await service.getFrontMatterIndex()).toEqual({ status: ['done'] });
  });
});
