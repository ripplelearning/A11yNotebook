// The shared accessible-reader capability contract (continuation plan,
// "Shared accessible reader"). Every document reader in the app declares
// what it provides against this one list, so parity between formats is a
// checkable fact instead of an assumption, and known gaps are explicit
// data that the staged adapter work (ePub/DOCX/PDF annotations) closes
// one by one. Capabilities describe the accessible experience: semantic
// structure in the reading DOM, keyboard/screen-reader operable
// commands, and the annotation lifecycle — not internal implementation.

export const READER_CAPABILITIES = [
  'outline',
  'sequential-navigation',
  'semantic-structure',
  'search',
  'bookmarks',
  'reading-position',
  'annotation-create',
  'annotation-list',
  'annotation-jump',
  'annotation-edit',
  'annotation-delete',
  'quote-export',
  'orphan-status',
  'lifecycle-cleanup',
] as const;

export type ReaderCapability = (typeof READER_CAPABILITIES)[number];

/** Format-native anchor kinds; readers must not be forced into another format's coordinates. */
export type ReaderAnchorKind = 'semantic-text' | 'pdf-page-range' | 'epub-cfi' | 'docx-paragraph-run';

export interface ReaderContract {
  format: string;
  anchorKind: ReaderAnchorKind;
  capabilities: Record<ReaderCapability, boolean>;
}

function contract(
  format: string,
  anchorKind: ReaderAnchorKind,
  provided: readonly ReaderCapability[],
): ReaderContract {
  const capabilities = Object.fromEntries(
    READER_CAPABILITIES.map((capability) => [capability, provided.includes(capability)]),
  ) as Record<ReaderCapability, boolean>;
  return { format, anchorKind, capabilities };
}

const NOTE_ANNOTATIONS: readonly ReaderCapability[] = [
  'annotation-create',
  'annotation-list',
  'annotation-jump',
  'annotation-edit',
  'annotation-delete',
  'quote-export',
  'orphan-status',
];

/**
 * Note readers (Markdown, sanitized HTML, plain text) share one reading
 * and annotation implementation over the rendered DOM, so their contracts
 * are identical — the parity requirement. Reading position is the one
 * documented gap: notes do not yet persist a caret/scroll position.
 */
const noteReader = (format: string): ReaderContract =>
  contract(format, 'semantic-text', [
    'outline',
    'sequential-navigation',
    'semantic-structure',
    'search',
    'bookmarks',
    ...NOTE_ANNOTATIONS,
    'lifecycle-cleanup',
  ]);

export const READER_CONTRACTS: readonly ReaderContract[] = [
  noteReader('markdown-notes'),
  noteReader('html-notes'),
  noteReader('text-notes'),
  // ePub: TOC, semantic chapters, bounded search, and persisted reading
  // position exist; annotations are a separate open item.
  contract('epub', 'epub-cfi', ['outline', 'sequential-navigation', 'semantic-structure', 'search', 'reading-position', 'lifecycle-cleanup']),
  // DOCX: semantic reading with headings/lists/tables/links, navigation
  // and search; annotations are a separate open item.
  contract('docx', 'docx-paragraph-run', ['outline', 'sequential-navigation', 'semantic-structure', 'search', 'lifecycle-cleanup']),
  // PDF: full annotation support with quote export and orphan status;
  // notes/bookmarks concepts from the vault do not apply to previews,
  // and the reader does not surface the document outline.
  contract('pdf', 'pdf-page-range', [
    'sequential-navigation',
    'semantic-structure',
    'search',
    'annotation-create',
    'annotation-list',
    'annotation-jump',
    'annotation-edit',
    'annotation-delete',
    'quote-export',
    'orphan-status',
    'lifecycle-cleanup',
  ]),
];

/** The capabilities a full note reader must provide today. */
export const REQUIRED_NOTE_READER_CAPABILITIES: readonly ReaderCapability[] = [
  'outline',
  'sequential-navigation',
  'semantic-structure',
  'search',
  'bookmarks',
  ...NOTE_ANNOTATIONS,
  'lifecycle-cleanup',
];

export function getReaderContract(format: string): ReaderContract | undefined {
  return READER_CONTRACTS.find((entry) => entry.format === format);
}

/** Capabilities from `required` that the contract does not provide. */
export function missingCapabilities(
  reader: ReaderContract,
  required: readonly ReaderCapability[],
): ReaderCapability[] {
  return required.filter((capability) => !reader.capabilities[capability]);
}

/** True when two readers provide exactly the same capability set. */
export function capabilitiesMatch(a: ReaderContract, b: ReaderContract): boolean {
  return READER_CAPABILITIES.every((capability) => a.capabilities[capability] === b.capabilities[capability]);
}
