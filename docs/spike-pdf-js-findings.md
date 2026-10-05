# PDF.js accessible-reading feasibility spike

## Setup

- The application and lockfile pin `pdfjs-dist` to **6.4.299**. This spike ran on Node 22.23.3.
- Ran `npm test -- --reporter=verbose src/test/spike-pdf-js-feasibility.test.ts`; all four fixture probes completed in under one second (well below the 30-second limit).
- The spike reuses the repository's self-contained PDF fixture builder in `src/test/fixtures/pdf-fixtures.ts`; no dependency or fixture asset was added. `untaggedReport.pdf` and `pageNumbers.pdf` are both generated from the same two-page untagged fixture (the page-number case uses the same PDF bytes).

## Findings

- **Structure tree:** `page.getStructTree()` returned a structure object for tagged page 1 and `null` for untagged and rotated pages. The tagged tree exposes `Document`, `H1`, `P`, `L`, `LI`, and `LBody`, language values, and content IDs. The fixture also contains table and link structure on page 2, but this diagnostic intentionally probes page 1 only.
- **Marked content:** tagged text items expose `beginMarkedContentProps` with semantic tags and IDs such as `H1` / `p32R_mc0`; the IDs match content IDs in the structure tree. Artifact items expose `tag: "Artifact"` but have `id: null`.
- **Artifact subtype:** PDF.js does **not** return the artifact `/Type` or `/Subtype` in these marked-content items. `Header`, `Footer`, and `PageNum` are consequently not distinguishable by subtype in this API output.
- **Headers and footers:** untagged page text includes the running header and the printed `Page 1 of 2` footer, with text transforms/positions. The fixture generator repeats those items in consistent positions, but this probe only queries page 1 and the API does not label them as header/footer; identifying them would require inference from content, position, or cross-page comparison. A true heading can also match a running header in the tagged fixture's page 3.
- **Other APIs:** `getPageLabels()` returned `["i","ii","1"]` for the tagged fixture and `null` for the untagged fixtures. `getMetadata()` returned document info and `hasStructTree`; XMP metadata was `null` in these fixtures. **`doc.getFingerprints()` is unavailable** and throws `TypeError`; the pinned API instead exposes `doc.fingerprints`, which returned a fingerprint array. `getAnnotations()` returned an empty array on page 1; the tagged sample's link annotation is on page 2 and was not queried by this page-1-only probe.
- The output is fixture evidence, not a claim that every PDF is tagged or that layout-based header/footer classification is reliable.

## Complete raw probe output

The following is the complete JSON payload between `PDFJS_SPIKE_RAW_OUTPUT_BEGIN` and `PDFJS_SPIKE_RAW_OUTPUT_END` from the test run. The JSON is compact to preserve the full API results without truncation.

```json
{
  "pdfjsVersion": "6.4.299",
  "taggedReport.pdf": {
    "numPages": 3,
    "probes": [
      { "name": "doc.getPageLabels()", "result": ["i", "ii", "1"] },
      {
        "name": "doc.getFingerprints()",
        "error": {
          "name": "TypeError",
          "message": "doc.getFingerprints is not a function"
        }
      },
      {
        "name": "doc.getMetadata()",
        "result": {
          "info": {
            "PDFFormatVersion": "1.7",
            "Language": "en-GB",
            "EncryptFilterName": null,
            "IsLinearized": false,
            "IsAcroFormPresent": false,
            "IsXFAPresent": false,
            "IsCollectionPresent": false,
            "IsSignaturesPresent": false,
            "Title": "Quarterly Accessibility Report",
            "Producer": "A11y Notebook fixtures"
          },
          "metadata": null,
          "contentDispositionFilename": null,
          "contentLength": null,
          "hasStructTree": true
        }
      },
      { "name": "doc.fingerprints", "result": ["cf63265a5f5fdff004d5bf829e43f00e", null] },
      {
        "name": "page.getTextContent({ includeMarkedContent: true })",
        "result": {
          "items": [
            { "type": "beginMarkedContentProps", "id": null, "tag": "Artifact" },
            {
              "str": "Quarterly Accessibility Report",
              "dir": "ltr",
              "width": 118.02600000000004,
              "height": 9,
              "transform": [9, 0, 0, 9, 72, 750],
              "fontName": "g_d0_f1",
              "hasEOL": false
            },
            { "type": "endMarkedContent" },
            { "type": "beginMarkedContentProps", "id": null, "tag": "Artifact" },
            {
              "str": "",
              "dir": "ltr",
              "width": 0,
              "height": 0,
              "transform": [9, 0, 0, 9, 72, 40],
              "fontName": "g_d0_f1",
              "hasEOL": true
            },
            {
              "str": "Confidential draft",
              "dir": "ltr",
              "width": 68.03099999999999,
              "height": 9,
              "transform": [9, 0, 0, 9, 72, 40],
              "fontName": "g_d0_f1",
              "hasEOL": false
            },
            { "type": "endMarkedContent" },
            { "type": "beginMarkedContentProps", "id": null, "tag": "Artifact" },
            {
              "str": " ",
              "dir": "ltr",
              "width": 379.96899999999994,
              "height": 0,
              "transform": [9, 0, 0, 9, 140.03100000000006, 40],
              "fontName": "g_d0_f1",
              "hasEOL": false
            },
            {
              "str": "1",
              "dir": "ltr",
              "width": 5.0040000000000004,
              "height": 9,
              "transform": [9, 0, 0, 9, 520, 40],
              "fontName": "g_d0_f1",
              "hasEOL": false
            },
            { "type": "endMarkedContent" },
            { "type": "beginMarkedContentProps", "id": "p32R_mc2", "tag": "P" },
            {
              "str": "",
              "dir": "ltr",
              "width": 0,
              "height": 0,
              "transform": [12, 0, 0, 12, 72, 600],
              "fontName": "g_d0_f1",
              "hasEOL": true
            },
            {
              "str": "Second paragraph follows the introduction.",
              "dir": "ltr",
              "width": 227.448,
              "height": 12,
              "transform": [12, 0, 0, 12, 72, 600],
              "fontName": "g_d0_f1",
              "hasEOL": false
            },
            { "type": "endMarkedContent" },
            { "type": "beginMarkedContentProps", "id": "p32R_mc0", "tag": "H1" },
            {
              "str": "",
              "dir": "ltr",
              "width": 0,
              "height": 0,
              "transform": [20, 0, 0, 20, 72, 700],
              "fontName": "g_d0_f2",
              "hasEOL": true
            },
            {
              "str": "Accessible Reading",
              "dir": "ltr",
              "width": 188.96000000000004,
              "height": 20,
              "transform": [20, 0, 0, 20, 72, 700],
              "fontName": "g_d0_f2",
              "hasEOL": false
            },
            { "type": "endMarkedContent" },
            { "type": "beginMarkedContentProps", "id": "p32R_mc1", "tag": "P" },
            {
              "str": "",
              "dir": "ltr",
              "width": 0,
              "height": 0,
              "transform": [12, 0, 0, 12, 72, 660],
              "fontName": "g_d0_f1",
              "hasEOL": true
            },
            {
              "str": "Introduction paragraph for the report.",
              "dir": "ltr",
              "width": 196.10400000000007,
              "height": 12,
              "transform": [12, 0, 0, 12, 72, 660],
              "fontName": "g_d0_f1",
              "hasEOL": false
            },
            { "type": "endMarkedContent" },
            { "type": "beginMarkedContentProps", "id": "p32R_mc3", "tag": "LBody" },
            {
              "str": "",
              "dir": "ltr",
              "width": 0,
              "height": 0,
              "transform": [12, 0, 0, 12, 90, 560],
              "fontName": "g_d0_f1",
              "hasEOL": true
            },
            {
              "str": "First list item",
              "dir": "ltr",
              "width": 67.33200000000001,
              "height": 12,
              "transform": [12, 0, 0, 12, 90, 560],
              "fontName": "g_d0_f1",
              "hasEOL": false
            },
            { "type": "endMarkedContent" },
            { "type": "beginMarkedContentProps", "id": "p32R_mc4", "tag": "LBody" },
            {
              "str": "",
              "dir": "ltr",
              "width": 0,
              "height": 0,
              "transform": [12, 0, 0, 12, 90, 540],
              "fontName": "g_d0_f1",
              "hasEOL": true
            },
            {
              "str": "Second list item",
              "dir": "ltr",
              "width": 84.69600000000001,
              "height": 12,
              "transform": [12, 0, 0, 12, 90, 540],
              "fontName": "g_d0_f1",
              "hasEOL": false
            },
            { "type": "endMarkedContent" },
            { "type": "beginMarkedContentProps", "id": "p32R_mc5", "tag": "P" },
            {
              "str": "",
              "dir": "ltr",
              "width": 0,
              "height": 0,
              "transform": [12, 0, 0, 12, 72, 500],
              "fontName": "g_d0_f1",
              "hasEOL": true
            },
            {
              "str": "Bonjour le monde",
              "dir": "ltr",
              "width": 94.04399999999998,
              "height": 12,
              "transform": [12, 0, 0, 12, 72, 500],
              "fontName": "g_d0_f1",
              "hasEOL": false
            },
            { "type": "endMarkedContent" }
          ],
          "styles": {
            "g_d0_f1": { "fontFamily": "sans-serif", "ascent": 0.718, "descent": -0.207, "vertical": false },
            "g_d0_f2": { "fontFamily": "sans-serif", "ascent": 0.718, "descent": -0.207, "vertical": false }
          },
          "lang": "en-GB"
        }
      },
      {
        "name": "page.getStructTree()",
        "result": {
          "children": [
            {
              "role": "Document",
              "children": [
                { "role": "H1", "children": [{ "type": "content", "id": "p32R_mc0" }] },
                { "role": "P", "children": [{ "type": "content", "id": "p32R_mc1" }] },
                { "role": "P", "children": [{ "type": "content", "id": "p32R_mc2" }] },
                {
                  "role": "L",
                  "children": [
                    {
                      "role": "LI",
                      "children": [{ "role": "LBody", "children": [{ "type": "content", "id": "p32R_mc3" }] }]
                    },
                    {
                      "role": "LI",
                      "children": [{ "role": "LBody", "children": [{ "type": "content", "id": "p32R_mc4" }] }]
                    }
                  ]
                },
                { "role": "P", "children": [{ "type": "content", "id": "p32R_mc5" }], "lang": "fr-FR" }
              ],
              "lang": "en-GB"
            }
          ],
          "role": "Root"
        }
      },
      { "name": "page.getAnnotations()", "result": [] }
    ]
  },
  "untaggedReport.pdf": {
    "numPages": 2,
    "probes": [
      { "name": "doc.getPageLabels()", "result": null },
      {
        "name": "doc.getFingerprints()",
        "error": {
          "name": "TypeError",
          "message": "doc.getFingerprints is not a function"
        }
      },
      {
        "name": "doc.getMetadata()",
        "result": {
          "info": {
            "PDFFormatVersion": "1.7",
            "Language": null,
            "EncryptFilterName": null,
            "IsLinearized": false,
            "IsAcroFormPresent": false,
            "IsXFAPresent": false,
            "IsCollectionPresent": false,
            "IsSignaturesPresent": false,
            "Title": "Field Notes Annual Review",
            "Producer": "A11y Notebook fixtures"
          },
          "metadata": null,
          "contentDispositionFilename": null,
          "contentLength": null,
          "hasStructTree": false
        }
      },
      { "name": "doc.fingerprints", "result": ["9cd885c067976cae552570c4e33edaa3", null] },
      {
        "name": "page.getTextContent({ includeMarkedContent: true })",
        "result": {
          "items": [
            {
              "str": "Field Notes Annual Review",
              "dir": "ltr",
              "width": 108.03600000000004,
              "height": 9,
              "transform": [9, 0, 0, 9, 72, 752],
              "fontName": "g_d1_f1",
              "hasEOL": false
            },
            {
              "str": "",
              "dir": "ltr",
              "width": 0,
              "height": 0,
              "transform": [16, 0, 0, 16, 72, 700],
              "fontName": "g_d1_f2",
              "hasEOL": true
            },
            {
              "str": "Introduction",
              "dir": "ltr",
              "width": 93.328,
              "height": 16,
              "transform": [16, 0, 0, 16, 72, 700],
              "fontName": "g_d1_f2",
              "hasEOL": false
            },
            {
              "str": "",
              "dir": "ltr",
              "width": 0,
              "height": 0,
              "transform": [12, 0, 0, 12, 72, 660],
              "fontName": "g_d1_f1",
              "hasEOL": true
            },
            {
              "str": "Summary",
              "dir": "ltr",
              "width": 51.336,
              "height": 12,
              "transform": [12, 0, 0, 12, 72, 660],
              "fontName": "g_d1_f1",
              "hasEOL": true
            },
            {
              "str": "Body text unique to page 1.",
              "dir": "ltr",
              "width": 146.10000000000002,
              "height": 12,
              "transform": [12, 0, 0, 12, 72, 640],
              "fontName": "g_d1_f1",
              "hasEOL": false
            },
            {
              "str": "",
              "dir": "ltr",
              "width": 0,
              "height": 0,
              "transform": [9, 0, 0, 9, 250, 40],
              "fontName": "g_d1_f1",
              "hasEOL": true
            },
            {
              "str": "Page 1 of 2",
              "dir": "ltr",
              "width": 46.03500000000003,
              "height": 9,
              "transform": [9, 0, 0, 9, 250, 40],
              "fontName": "g_d1_f1",
              "hasEOL": false
            }
          ],
          "styles": {
            "g_d1_f1": { "fontFamily": "sans-serif", "ascent": 0.718, "descent": -0.207, "vertical": false },
            "g_d1_f2": { "fontFamily": "sans-serif", "ascent": 0.718, "descent": -0.207, "vertical": false }
          },
          "lang": null
        }
      },
      { "name": "page.getStructTree()", "result": null },
      { "name": "page.getAnnotations()", "result": [] }
    ]
  },
  "pageNumbers.pdf": {
    "numPages": 2,
    "probes": [
      { "name": "doc.getPageLabels()", "result": null },
      {
        "name": "doc.getFingerprints()",
        "error": {
          "name": "TypeError",
          "message": "doc.getFingerprints is not a function"
        }
      },
      {
        "name": "doc.getMetadata()",
        "result": {
          "info": {
            "PDFFormatVersion": "1.7",
            "Language": null,
            "EncryptFilterName": null,
            "IsLinearized": false,
            "IsAcroFormPresent": false,
            "IsXFAPresent": false,
            "IsCollectionPresent": false,
            "IsSignaturesPresent": false,
            "Title": "Field Notes Annual Review",
            "Producer": "A11y Notebook fixtures"
          },
          "metadata": null,
          "contentDispositionFilename": null,
          "contentLength": null,
          "hasStructTree": false
        }
      },
      { "name": "doc.fingerprints", "result": ["9cd885c067976cae552570c4e33edaa3", null] },
      {
        "name": "page.getTextContent({ includeMarkedContent: true })",
        "result": {
          "items": [
            {
              "str": "Field Notes Annual Review",
              "dir": "ltr",
              "width": 108.03600000000004,
              "height": 9,
              "transform": [9, 0, 0, 9, 72, 752],
              "fontName": "g_d2_f1",
              "hasEOL": false
            },
            {
              "str": "",
              "dir": "ltr",
              "width": 0,
              "height": 0,
              "transform": [16, 0, 0, 16, 72, 700],
              "fontName": "g_d2_f2",
              "hasEOL": true
            },
            {
              "str": "Introduction",
              "dir": "ltr",
              "width": 93.328,
              "height": 16,
              "transform": [16, 0, 0, 16, 72, 700],
              "fontName": "g_d2_f2",
              "hasEOL": false
            },
            {
              "str": "",
              "dir": "ltr",
              "width": 0,
              "height": 0,
              "transform": [12, 0, 0, 12, 72, 660],
              "fontName": "g_d2_f1",
              "hasEOL": true
            },
            {
              "str": "Summary",
              "dir": "ltr",
              "width": 51.336,
              "height": 12,
              "transform": [12, 0, 0, 12, 72, 660],
              "fontName": "g_d2_f1",
              "hasEOL": true
            },
            {
              "str": "Body text unique to page 1.",
              "dir": "ltr",
              "width": 146.10000000000002,
              "height": 12,
              "transform": [12, 0, 0, 12, 72, 640],
              "fontName": "g_d2_f1",
              "hasEOL": false
            },
            {
              "str": "",
              "dir": "ltr",
              "width": 0,
              "height": 0,
              "transform": [9, 0, 0, 9, 250, 40],
              "fontName": "g_d2_f1",
              "hasEOL": true
            },
            {
              "str": "Page 1 of 2",
              "dir": "ltr",
              "width": 46.03500000000003,
              "height": 9,
              "transform": [9, 0, 0, 9, 250, 40],
              "fontName": "g_d2_f1",
              "hasEOL": false
            }
          ],
          "styles": {
            "g_d2_f1": { "fontFamily": "sans-serif", "ascent": 0.718, "descent": -0.207, "vertical": false },
            "g_d2_f2": { "fontFamily": "sans-serif", "ascent": 0.718, "descent": -0.207, "vertical": false }
          },
          "lang": null
        }
      },
      { "name": "page.getStructTree()", "result": null },
      { "name": "page.getAnnotations()", "result": [] }
    ]
  },
  "rotated.pdf": {
    "numPages": 1,
    "probes": [
      { "name": "doc.getPageLabels()", "result": null },
      {
        "name": "doc.getFingerprints()",
        "error": {
          "name": "TypeError",
          "message": "doc.getFingerprints is not a function"
        }
      },
      {
        "name": "doc.getMetadata()",
        "result": {
          "info": {
            "PDFFormatVersion": "1.7",
            "Language": null,
            "EncryptFilterName": null,
            "IsLinearized": false,
            "IsAcroFormPresent": false,
            "IsXFAPresent": false,
            "IsCollectionPresent": false,
            "IsSignaturesPresent": false
          },
          "metadata": null,
          "contentDispositionFilename": null,
          "contentLength": null,
          "hasStructTree": false
        }
      },
      { "name": "doc.fingerprints", "result": ["efce9f233a8795a7e27f010d6c5aa242", null] },
      {
        "name": "page.getTextContent({ includeMarkedContent: true })",
        "result": {
          "items": [
            {
              "str": "Rotated heading text",
              "dir": "ltr",
              "width": 129.19200000000004,
              "height": 14,
              "transform": [14, 0, 0, 14, 72, 700],
              "fontName": "g_d3_f1",
              "hasEOL": false
            },
            {
              "str": "",
              "dir": "ltr",
              "width": 0,
              "height": 0,
              "transform": [12, 0, 0, 12, 72, 670],
              "fontName": "g_d3_f1",
              "hasEOL": true
            },
            {
              "str": "Rotated body sentence.",
              "dir": "ltr",
              "width": 126.74399999999999,
              "height": 12,
              "transform": [12, 0, 0, 12, 72, 670],
              "fontName": "g_d3_f1",
              "hasEOL": false
            }
          ],
          "styles": {
            "g_d3_f1": { "fontFamily": "sans-serif", "ascent": 0.718, "descent": -0.207, "vertical": false }
          },
          "lang": null
        }
      },
      { "name": "page.getStructTree()", "result": null },
      { "name": "page.getAnnotations()", "result": [] }
    ]
  }
}
```
