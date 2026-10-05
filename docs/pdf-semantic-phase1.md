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
structure tree is appended rather than discarded. No extracted content is
hidden.

Untagged pages use inferred paragraph grouping. Repeated text in page margins
and printed page-number patterns are identified as guesses, never removed.
`DocumentReaderModel` is shared by PDF pages and ePub spine sections; the ePub
parser and its navigation behavior remain unchanged.

## Current boundary

This is a read-only semantic layer. It does not store annotations, persist
anchors, hide content, or provide preference controls. Browser screen-reader
verification and detailed alignment checks for unusual PDF fonts/layouts still
require manual testing.
