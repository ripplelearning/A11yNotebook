import { useState } from 'react';
import Modal from '../../components/Modal';
import type { VaultEntry, VaultLink } from '../../../shared/types';

export interface BrokenLinkNoteOption {
  path: string;
  title: string;
}

function flattenEntries(entries: VaultEntry[]): VaultEntry[] {
  return entries.flatMap((entry) => [entry, ...(entry.children ? flattenEntries(entry.children) : [])]);
}

function isNotePath(value: string): boolean {
  return /\.(?:md|html|htm|txt)$/i.test(value);
}

function BrokenLinkRow({
  index,
  link,
  notes,
  candidateExists,
  onCreate,
  onRetarget,
}: {
  index: number;
  link: VaultLink;
  notes: BrokenLinkNoteOption[];
  candidateExists: boolean;
  onCreate: (candidatePath: string) => void;
  onRetarget: (link: VaultLink, newPath: string) => void;
}) {
  const [target, setTarget] = useState('');
  const selectId = `broken-link-target-${index}`;
  const createDisabled = !link.candidatePath || candidateExists || !isNotePath(link.candidatePath);
  const createReason = !link.candidatePath
    ? 'No note can be created for this link; retarget it instead.'
    : candidateExists
      ? 'A file already exists at that path; retarget instead.'
      : !isNotePath(link.candidatePath)
        ? 'Only notes can be created from a link.'
        : undefined;
  const retargetOptions = notes.filter((note) => note.path !== link.sourcePath);
  return (
    <li>
      <p>
        In {link.sourcePath}: “{link.targetTitle}”
        {link.candidatePath ? ` — would create ${link.candidatePath}` : ''}
      </p>
      <div className="modal-actions">
        <button type="button" disabled={createDisabled} onClick={() => link.candidatePath && onCreate(link.candidatePath)}>
          Create note
        </button>
        <label htmlFor={selectId}>Retarget to</label>
        <select id={selectId} value={target} onChange={(event) => setTarget(event.target.value)}>
          <option value="">Choose a note</option>
          {retargetOptions.map((note) => (
            <option key={note.path} value={note.path}>
              {note.title} ({note.path})
            </option>
          ))}
        </select>
        <button type="button" disabled={!target} onClick={() => target && onRetarget(link, target)}>
          Retarget
        </button>
      </div>
      {createReason ? <p>{createReason}</p> : null}
    </li>
  );
}

export function BrokenLinksDialog({
  links,
  notes,
  entries,
  filterSource,
  onClearFilter,
  onCreate,
  onRetarget,
  onClose,
}: {
  links: VaultLink[];
  notes: BrokenLinkNoteOption[];
  entries: VaultEntry[];
  filterSource: string | null;
  onClearFilter: () => void;
  onCreate: (candidatePath: string) => void;
  onRetarget: (link: VaultLink, newPath: string) => void;
  onClose: () => void;
}) {
  const allEntries = flattenEntries(entries);
  const existingPaths = new Set(allEntries.map((entry) => entry.path));
  return (
    <Modal
      titleId="broken-links-dialog-title"
      title={filterSource ? `Broken links in ${filterSource}` : 'Broken links'}
      describedBy="broken-links-dialog-summary"
      onClose={onClose}
      className="wide-modal"
    >
      <div className="modal-body">
        <p id="broken-links-dialog-summary">
          These links point at notes that do not exist. Create the missing note, or retarget the link to a note that
          does.
        </p>
        {filterSource ? (
          <button type="button" onClick={onClearFilter}>
            Show all broken links
          </button>
        ) : null}
        {links.length ? (
          <ul>
            {links.map((link, index) => (
              <BrokenLinkRow
                key={`${link.sourcePath}-${index}`}
                index={index}
                link={link}
                notes={notes}
                candidateExists={!!link.candidatePath && existingPaths.has(link.candidatePath)}
                onCreate={onCreate}
                onRetarget={onRetarget}
              />
            ))}
          </ul>
        ) : (
          <p>No broken links.</p>
        )}
      </div>
      <div className="modal-actions">
        <button type="button" data-autofocus onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}
