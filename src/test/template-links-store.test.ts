// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createTemplateLinkStore } from '../../electron/vault/template-links';

function memoryStore() {
  let saved: unknown = null;
  return {
    store: createTemplateLinkStore({
      read: async () => saved,
      write: async (value) => {
        saved = value;
      },
      validateNote: async (path) => {
        if (!/\.(?:md|html?)$/i.test(path)) throw new Error('Template links require a note.');
      },
    }),
    snapshot: () => saved,
  };
}

describe('template links store', () => {
  it('saves and reads a link keyed by the filled note path', async () => {
    const { store } = memoryStore();
    expect(await store.get('Notes/Intake.md')).toBeNull();
    const saved = await store.save('Notes/Intake.md', 'Templates/Intake.md');
    expect(saved?.path).toBe('Notes/Intake.md');
    expect(saved?.templatePath).toBe('Templates/Intake.md');
    expect(saved?.schemaVersion).toBe(1);
    expect(await store.get('Notes/Intake.md')).toBe('Templates/Intake.md');
    await store.save('Notes/Intake.md', 'Templates/Other.md');
    expect(await store.get('Notes/Intake.md')).toBe('Templates/Other.md');
  });

  it('deletes a link when saved with null', async () => {
    const { store } = memoryStore();
    await store.save('Notes/Intake.md', 'Templates/Intake.md');
    await store.save('Notes/Intake.md', null);
    expect(await store.get('Notes/Intake.md')).toBeNull();
  });

  it('rejects bad paths and non-note paths', async () => {
    const { store } = memoryStore();
    await expect(store.get('../outside.md')).rejects.toThrow('Invalid template link path');
    await expect(store.get('Notes/file.pdf')).rejects.toThrow('Template links require a note');
    await expect(store.save('Notes/Intake.md', '../Templates/Intake.md')).rejects.toThrow('Invalid template link path');
  });

  it('follows the filled note when it is renamed or moved', async () => {
    const { store } = memoryStore();
    await store.save('Notes/Intake.md', 'Templates/Intake.md');
    await store.migratePaths('Notes/Intake.md', 'Archive/Intake.md');
    expect(await store.get('Notes/Intake.md')).toBeNull();
    expect(await store.get('Archive/Intake.md')).toBe('Templates/Intake.md');
  });

  it('follows the template when it is renamed or moved', async () => {
    const { store } = memoryStore();
    await store.save('Notes/Intake.md', 'Templates/Intake.md');
    await store.save('Notes/Second.md', 'Templates/Intake.md');
    await store.migratePaths('Templates/Intake.md', 'Templates/Client Intake.md');
    expect(await store.get('Notes/Intake.md')).toBe('Templates/Client Intake.md');
    expect(await store.get('Notes/Second.md')).toBe('Templates/Client Intake.md');
  });

  it('follows a whole notebook move for both sides of the link', async () => {
    const { store } = memoryStore();
    await store.save('Notes/Intake.md', 'Templates/Intake.md');
    await store.migratePaths('Notes', 'Archive');
    expect(await store.get('Archive/Intake.md')).toBe('Templates/Intake.md');
    await store.migratePaths('Templates', 'Archive/Templates');
    expect(await store.get('Archive/Intake.md')).toBe('Archive/Templates/Intake.md');
  });
});
