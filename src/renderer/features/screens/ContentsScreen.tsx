import type { VaultEntry, VaultInfo } from '../../../shared/types';

type ScreenId = 'libraries' | 'notebooks' | 'notes-files';

interface ContentsScreenProps {
  vault: VaultInfo | null;
  entries: readonly VaultEntry[];
  onNavigate: (screen: ScreenId) => void;
}

function flatten(entries: readonly VaultEntry[]): VaultEntry[] {
  return entries.flatMap((entry) => [entry, ...flatten(entry.children ?? [])]);
}

export default function ContentsScreen({ vault, entries, onNavigate }: ContentsScreenProps) {
  const items = flatten(entries);
  const sections: { id: ScreenId; label: string; count: number }[] = [
    { id: 'libraries', label: 'Libraries', count: vault ? 1 : 0 },
    { id: 'notebooks', label: 'Notebooks', count: items.filter((entry) => entry.kind === 'notebook').length },
    {
      id: 'notes-files',
      label: 'Notes & Files',
      count: items.filter((entry) => entry.kind !== 'notebook').length,
    },
  ];

  return (
    <section aria-labelledby="contents-heading">
      <h2 id="contents-heading">Contents</h2>
      <p>{vault ? `Current library: ${vault.name}` : 'No library is open.'}</p>
      <ul>
        {sections.map((section) => (
          <li key={section.id}>
            <button type="button" onClick={() => onNavigate(section.id)}>
              {section.label} ({section.count})
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
