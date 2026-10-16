// @vitest-environment node
import { lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProvenanceStore } from '../../electron/vault/provenance';
import { createVaultService } from '../../electron/vault/service';

const mock = vi.hoisted(() => ({ shortReads: false, reads: 0, failPersist: false }));
vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>();
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args);
      if (!String(args[0]).endsWith('provenance.json') || !mock.shortReads) return handle;
      return new Proxy(handle, {
        get(target, property) {
          if (property === 'read')
            return (buffer: Buffer, offset: number, length: number, position: number) => {
              mock.reads += 1;
              return target.read(buffer, offset, Math.min(length, 7), position);
            };
          const value = Reflect.get(target, property, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    },
    rename: async (...args: Parameters<typeof actual.rename>) => {
      if (mock.failPersist && String(args[1]).endsWith('provenance.json')) throw new Error('Disk full');
      return actual.rename(...args);
    },
  };
});

let root: string;
let service: ReturnType<typeof createVaultService> | undefined;
beforeEach(async () => {
  root = path.join(process.cwd(), `.provenance-test-${randomUUID()}`);
  await mkdir(root);
  mock.shortReads = false;
  mock.reads = 0;
  mock.failPersist = false;
});
afterEach(async () => {
  await service?.dispose();
  service = undefined;
  await rm(root, { recursive: true, force: true });
});

describe('durable provenance resilience', () => {
  it('loads valid metadata even when regular file reads return short chunks', async () => {
    const target = path.join(root, 'Topic.md');
    await writeFile(target, '# Topic');
    const resolve = async (name: string) => path.join(root, name);
    const original = createProvenanceStore(resolve);
    await original.record('Topic.md', target, 'app-created');
    mock.shortReads = true;
    const reopened = createProvenanceStore(resolve);
    await reopened.initialize();
    expect(mock.reads).toBeGreaterThan(2);
    expect(reopened.get('Topic.md', await lstat(target))).toBe('app-created');
  });

  it('explains partial import success and fails closed after failed provenance persistence', async () => {
    service = createVaultService(root);
    await service.initialize();
    await writeFile(path.join(root, 'Source.md'), '# Source');
    mock.failPersist = true;
    await expect(service.importEntry('Source.md')).rejects.toThrow('File copied as');
    const copy = (await service.getVault()).entries.find((entry) => entry.path.startsWith('Imported-'))!;
    expect(await readFile(path.join(root, copy.path), 'utf8')).toBe('# Source');
    expect(await readFile(path.join(root, 'Source.md'), 'utf8')).toBe('# Source');
    await service.dispose();
    mock.failPersist = false;
    service = createVaultService(root);
    await service.initialize();
    expect(await service.getProvenance(copy.path)).toBe('unknown');
  });
});
