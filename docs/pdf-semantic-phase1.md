# Shared PDF semantic reading model

## Phase 0 findings carried forward

The Phase 0 spike verified the bundled `pdfjs-dist` 6.4.299 API against tagged,
untagged, rotated, and real-world PDF fixtures:

- `PDFDocumentProxy.fingerprints` provides the primary and optional check
  fingerprints. There is no `getFingerprints()` method; the reader also computes
  a SHA-256 hash of the loaded bytes for document identity.
- `getPageLabels()`, `getMetadata()`, `getTextContent({ includeMarkedContent:
true })`, `getStructTree()`, and `getAnnotations()` are available.
- Structure-tree content IDs map to marked-content IDs in text extraction.
  Untagged pages return no structure tree.
- Artifacts are exposed with the generic `Artifact` tag but PDF.js does not
  expose their `/Type` or `/Subtype`. Repeated margin text and page numbers can
  only be inferred from text and position; inferred text remains visible.
- PDF.js takes ownership of typed-array input, so the reader passes a copy.
  The loading task owns cleanup.

Fixture evidence and raw probe output are in
[`spike-pdf-js-findings.md`](spike-pdf-js-findings.md).

## Reading and mapping flow

```text
PDF bytes ── SHA-256 + PDF.js ── PdfDocument
                                  │ metadata, labels, fingerprints
                                  └── PdfPage
                                       ├── marked text + StructTree
                                       │       └── TextModel (original offsets, normalized search)
                                       ├── StructAdapter ── semantic HTML
                                       │                 └── inferred paragraphs if untagged
                                       └── viewport transform ── canvas + selectable text layer

PDF page offsets + exact quote/context ── stable anchor input (no pixel identity)
ePub spine sections ── shared DocumentReaderModel ── existing section navigation/search
```

The canonical text model preserves PDF.js extraction order, Unicode strings,
synthetic spaces, and end-of-line boundaries. Search normalization removes soft
hyphens and folds Unicode compatibility forms while retaining a mapping back to
the original UTF-16 offsets. Coordinate conversion is a presentation mapping;
the page number and text offsets remain independent of zoom and rotation.

Tagged structure is rendered with native heading, paragraph, list, table, and
cell elements. Struct-provided table headers, scope, spans, language, figure
alternative text, and table summaries are retained. Text not referenced by the
structure tree is appended rather than discarded. By default, all extracted
content is exposed to assistive technology.

Untagged pages use inferred paragraph grouping. Repeated text in page margins
and printed page-number patterns are identified as guesses, never removed.
`DocumentReaderModel` is shared by PDF pages and ePub spine sections; the ePub
parser and its navigation behavior remain unchanged.

## Current boundary

The PDF itself remains read-only; annotations are separate vault metadata.
Browser screen-reader verification and detailed alignment checks for unusual
PDF fonts/layouts still require manual testing.

## Phase 2 — PDF Reading preferences

Settings now includes two independent, opt-in PDF Reading controls for running
headers/footers and printed page numbers. Both default to exposed (`false`).
Content remains visible, selectable, and searchable in visual and reflow views;
only classified artifacts receive `aria-hidden="true"`.

`pdfReadingPreferences` is persisted in the existing main-process
`a11y-notebook-store.json` store. Typed get/set IPC validates both boolean keys,
rejects unexpected keys, and broadcasts changes. Missing stored preferences
default silently; malformed values are logged and defaulted. The renderer
caches preferences, loads them at startup and when Settings opens, and refreshes
on app focus. Open PDFs update existing DOM attributes without reloading PDF
bytes, canvases, or selection layers.

Artifact nodes carry `data-pdf-artifact-type="header"`, `"footer"`, or
`"page-number"`. Explicit Header/Footer/PageNum markers are used when available;
generic Artifact tags alone are insufficient. PDF.js currently omits artifact
subtypes, so conservative margin/page-number and repeated-margin heuristics
remain necessary. Unmatched text stays exposed, including repeated body text.
Interactive/focused regions and user annotation regions are not hidden.

Manual Windows JAWS/NVDA/Narrator checks remain necessary to verify actual speech:
toggle each preference while a PDF is open, check both reading views, then
confirm that searching, selecting text, navigating pages, and restarting the app
retain their expected behavior.

## Phases 3–4 — Stable anchors and accessible notes

PDF targets store PDF.js fingerprint, SHA-256 file hash, vault-relative path,
one-based page, canonical UTF-16 range, original quote, normalized search quote,
and surrounding context. The metadata envelope is version 2; PDF, Markdown,
and HTML contracts are independently versioned at 1. Existing Markdown/HTML
records keep their original shape.

Resolution reports classification, confidence, and reason: unique exact match,
context-disambiguated match, normalized match, ambiguous fallback, or orphan.
Nearby pages are searched within a bounded range when the original page no
longer matches. A changed hash is unverified, not automatic permission to move
a highlight. Original quotes/context survive failed resolution. Manual
reconfirmation requires choosing current text; deletion is explicit.
An explicitly reconfirmed occurrence retains its canonical range only while
the file hash and exact text still match, so even identical repeated
quotations can be confirmed without trusting ambiguous automatic matches.

The PDF reader supports selected-text notes, an **Annotate a quote** dialog
with explicit match choices, and focused paragraph/heading/cell notes in the
accessible text view. The existing modal provides keyboard focus trapping,
Escape cancellation, labelled color choices, and label-or-comment validation.
Shift+F10, Applications, and right-click use the context-aware command menu;
the palette exposes PDF-specific commands without adding conflicting defaults.

Highlights are a separate, non-selecting, assistive-technology-hidden overlay.
Their geometry uses the same bounded viewport scale and rotation as the text
layer, while saved canonical ranges remain unchanged. Borders provide a
non-color-only cue, including forced-colors mode. Notes expose the quote and
resolution status separately from the decorative overlay.

The reader displays one page at a time, so a native pointer drag cannot cross
page boundaries. Grouped per-page targets share one note ID; selection mapping
supports multiple rendered page layers for future continuous-page reading.
Search and extraction remain capped at 500 pages and 20 MB. Unsupported PDFs
retain stored notes and quotes; encrypted PDFs are not silently decrypted.

PHASE 5 adds the annotation sidebar and bidirectional navigation. PHASE 6 adds
clipboard export. PHASE 7 covers broader lifecycle/performance/cleanup work.
None of those workflows, new Settings sections, or releases are included here.
