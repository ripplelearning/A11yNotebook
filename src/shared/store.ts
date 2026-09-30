import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

const storeFileName = 'a11y-notebook-store.json';

export const fallbackStore = {
  vaults: [
    {
      id: 'vault-1',
      name: 'Personal Knowledge Vault',
      description: 'Local-first home for notes, tasks, bookmarks, and documents.',
    },
  ],
  notebooks: [
    {
      id: 'notebook-1',
      name: 'Welcome Notebook',
      documents: [
        {
          id: 'document-1',
          title: 'Welcome',
          summary: 'First-access overview and accessibility foundation.',
          content:
            'Welcome to A11y Notebook. This foundation provides the shell, commands, and local persistence boundary needed for future vault features.',
        },
      ],
    },
  ],
};

export function getStorePath() {
  return path.join(app.getPath('userData'), storeFileName);
}

export function loadStore() {
  try {
    const json = readFileSync(getStorePath(), 'utf-8');
    return JSON.parse(json);
  } catch {
    return fallbackStore;
  }
}

export function saveStore(data: typeof fallbackStore) {
  const output = JSON.stringify(data, null, 2);
  writeFileSync(getStorePath(), output, 'utf-8');
}
