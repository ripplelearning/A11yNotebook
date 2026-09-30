export const sampleVault = {
  id: 'vault-1',
  name: 'Personal Knowledge Vault',
  description: 'Local-first home for notes, tasks, bookmarks, and documents.',
};

export const sampleNotebook = {
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
};

export const sampleDocument = {
  id: 'welcome',
  title: 'Welcome to A11y Notebook',
  summary: 'An overview of the application foundation and accessibility model.',
  content:
    'Welcome to A11y Notebook. Use the application shell, command palette, and keyboard shortcuts to navigate comfortably with screen readers and keyboard-only access.',
};
