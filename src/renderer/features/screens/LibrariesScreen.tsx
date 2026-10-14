import type { VaultInfo } from '../../../shared/types';

interface LibrariesScreenProps {
  vault: VaultInfo | null;
  onOpenLibrary: () => void;
}

export default function LibrariesScreen({ vault, onOpenLibrary }: LibrariesScreenProps) {
  return (
    <section aria-labelledby="libraries-heading">
      <h2 id="libraries-heading">Libraries</h2>
      <button type="button" onClick={onOpenLibrary}>
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
