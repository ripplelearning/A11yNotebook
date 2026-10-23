import type { RecentLibrary, VaultInfo } from '../../../shared/types';

interface LibrariesScreenProps {
  vault: VaultInfo | null;
  recentLibraries?: RecentLibrary[];
  onOpenLibrary: () => void;
  onNewLibrary?: () => void;
  onOpenRecent?: (path: string) => void;
  disabled?: boolean;
  showCommandButtons?: boolean;
}

export default function LibrariesScreen({
  vault,
  recentLibraries = [],
  onOpenLibrary,
  onNewLibrary,
  onOpenRecent,
  disabled,
  showCommandButtons = true,
}: LibrariesScreenProps) {
  return (
    <section aria-labelledby="libraries-heading">
      <h2 id="libraries-heading">{vault?.name ?? 'Libraries'}</h2>
      {showCommandButtons && (
        <>
          <button type="button" onClick={onNewLibrary} disabled={disabled || !onNewLibrary}>
            New library
          </button>
          <button type="button" onClick={onOpenLibrary} disabled={disabled}>
            Open library
          </button>
        </>
      )}
      {vault ? (
        <dl>
          <dt>Current library</dt>
          <dd>{vault.name}</dd>
        </dl>
      ) : (
        <p>No library is open. Open a local library to get started.</p>
      )}
      {recentLibraries.length > 0 && (
        <>
          <h3 id="recent-libraries-heading">Recent libraries</h3>
          <ul aria-labelledby="recent-libraries-heading">
            {recentLibraries.map((library) => {
              const isCurrent = vault?.path === library.path;
              return (
                <li key={library.path}>
                  <button
                    type="button"
                    onClick={() => onOpenRecent?.(library.path)}
                    disabled={disabled || isCurrent || !onOpenRecent}
                  >
                    Open {library.name}
                    {isCurrent ? ' (current)' : ''}
                  </button>{' '}
                  <span>{library.path}</span>
                  {library.lastOpenedAt ? (
                    <>
                      {' '}
                      <span>Last opened {new Date(library.lastOpenedAt).toLocaleDateString()}</span>
                    </>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
