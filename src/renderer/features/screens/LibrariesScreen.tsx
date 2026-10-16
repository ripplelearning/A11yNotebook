import type { VaultInfo } from '../../../shared/types';

interface LibrariesScreenProps {
  vault: VaultInfo | null;
  onOpenLibrary: () => void;
  onNewLibrary?: () => void;
  disabled?: boolean;
}

export default function LibrariesScreen({ vault, onOpenLibrary, onNewLibrary, disabled }: LibrariesScreenProps) {
  return (
    <section aria-labelledby="libraries-heading">
      <h2 id="libraries-heading">{vault?.name ?? 'Libraries'}</h2>
      <button type="button" onClick={onNewLibrary} disabled={disabled || !onNewLibrary}>
        New library
      </button>
      <button type="button" onClick={onOpenLibrary} disabled={disabled}>
        Open library
      </button>
      {vault ? (
        <dl>
          <dt>Current library</dt>
          <dd>{vault.name}</dd>
        </dl>
      ) : (
        <p>No library is open. Open a local library to get started.</p>
      )}
    </section>
  );
}
