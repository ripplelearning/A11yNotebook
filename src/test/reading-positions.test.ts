import { mkdir, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createVaultService } from '../../electron/vault/service';

let root = '';
const services: ReturnType<typeof createVaultService>[] = [];

beforeEach(async () => {
  root = path.resolve(`.test-reading-positions-${randomUUID()}`);
  await mkdir(path.join(root, 'Books'), { recursive: true });
  await writeFile(path.join(root, 'Books', 'Guide.epub'), 'epub bytes');
  await writeFile(path.join(root, 'Books', 'Notes.md'), '# Notes');
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

describe('ePub reading positions', () => {
  it('saves and returns the latest position for a book', async () => {
    const service = await vault();
    expect(await service.getReadingPosition('Books/Guide.epub')).toBeNull();
    await service.setReadingPosition('Books/Guide.epub', { cfi: 'epubcfi(/6/4!/4/2)', sectionIndex: 1 });
    const saved = await service.getReadingPosition('Books/Guide.epub');
    expect(saved?.cfi).toBe('epubcfi(/6/4!/4/2)');
    expect(saved?.sectionIndex).toBe(1);
    await service.setReadingPosition('Books/Guide.epub', { cfi: 'epubcfi(/6/8!/4/6)', sectionIndex: 3 });
    expect((await service.getReadingPosition('Books/Guide.epub'))?.sectionIndex).toBe(3);
  });

  it('persists positions across service instances', async () => {
    const first = await vault();
    await first.setReadingPosition('Books/Guide.epub', { cfi: 'epubcfi(/6/2)', sectionIndex: 0 });
    const second = await vault();
    expect((await second.getReadingPosition('Books/Guide.epub'))?.cfi).toBe('epubcfi(/6/2)');
  });

  it('rejects invalid positions and unsupported files', async () => {
    const service = await vault();
    await expect(service.setReadingPosition('Books/Guide.epub', { cfi: 'not-a-cfi', sectionIndex: 0 })).rejects.toThrow(
      /invalid/,
    );
    await expect(service.setReadingPosition('Books/Guide.epub', { cfi: '', sectionIndex: -1 })).rejects.toThrow(
      /invalid/,
    );
    await expect(
      service.setReadingPosition('Books/Notes.md', { cfi: 'epubcfi(/6/2)', sectionIndex: 0 }),
    ).rejects.toThrow(/invalid/);
    await expect(service.setReadingPosition('Books/Notes.md', { heading: '   ', occurrence: 0 })).rejects.toThrow(
      /invalid/,
    );
    await expect(service.setReadingPosition('Books/Notes.md', { heading: 'Intro', occurrence: -1 })).rejects.toThrow(
      /invalid/,
    );
    await expect(service.setReadingPosition('Books/Guide.epub', { heading: 'Intro', occurrence: 0 })).rejects.toThrow(
      /invalid/,
    );
  });

  it('follows the book when its entry is moved', async () => {
    const service = await vault();
    await service.setReadingPosition('Books/Guide.epub', { cfi: 'epubcfi(/6/4)', sectionIndex: 2 });
    await service.moveEntry('Books/Guide.epub', 'Books/Renamed.epub');
    expect(await service.getReadingPosition('Books/Guide.epub')).toBeNull();
    expect((await service.getReadingPosition('Books/Renamed.epub'))?.sectionIndex).toBe(2);
  });
});

describe('note reading positions', () => {
  it('saves and returns the latest heading position for a note', async () => {
    const service = await vault();
    expect(await service.getReadingPosition('Books/Notes.md')).toBeNull();
    await service.setReadingPosition('Books/Notes.md', { heading: 'Middle', occurrence: 0 });
    const saved = await service.getReadingPosition('Books/Notes.md');
    expect(saved?.heading).toBe('Middle');
    expect(saved?.occurrence).toBe(0);
    await service.setReadingPosition('Books/Notes.md', { heading: 'Notes', occurrence: 1 });
    expect((await service.getReadingPosition('Books/Notes.md'))?.heading).toBe('Notes');
    expect((await service.getReadingPosition('Books/Notes.md'))?.occurrence).toBe(1);
  });

  it('persists note positions across service instances and follows moves', async () => {
    const first = await vault();
    await first.setReadingPosition('Books/Notes.md', { heading: 'Later', occurrence: 0 });
    const second = await vault();
    expect((await second.getReadingPosition('Books/Notes.md'))?.heading).toBe('Later');
    await second.moveEntry('Books/Notes.md', 'Books/Renamed.md');
    expect(await second.getReadingPosition('Books/Notes.md')).toBeNull();
    expect((await second.getReadingPosition('Books/Renamed.md'))?.heading).toBe('Later');
  });
});
