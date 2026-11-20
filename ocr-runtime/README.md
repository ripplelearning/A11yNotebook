# OCR runtime (vendored Tesseract.js)

The "OCR this file" feature runs entirely on the device with
[Tesseract.js](https://tesseract.projectnaptha.com/) 6.0.1. The Electron
renderer cannot load the worker, core, and language data from a CDN — the
app's content security policy allows only local sources — so the runtime is
vendored here and served by the main process over the privileged `ocr-data:`
scheme (see `electron/ocr-runtime.ts`).

## Contents

- `worker.min.js` — the Tesseract.js web worker (from `node_modules/tesseract.js/dist/`).
- `tesseract-core-lstm.js` / `.wasm` / `.wasm.js` and the SIMD variants —
  the LSTM-only recognizer core (from `node_modules/tesseract.js-core/`).
  The app loads only the LSTM core (`OEM.LSTM_ONLY`).
- `lang/eng.traineddata.gz` — English language data (`4.0.0_best_int`),
  bundled so English OCR works offline with no download. Other languages
  download once on first use, from the same `@tesseract.js-data` package
  family, and are cached under the app's user-data directory.

## Refreshing

After a `tesseract.js` upgrade, run from the repo root:

```
node scripts/copy-ocr-runtime.mjs
```

It copies the worker and core from the installed packages and downloads
English language data if it is missing (network needed for that step only).
Then re-run the OCR unit tests (`src/test/ocr-*.test.*`) and the E2E OCR
spec (`e2e/ocr.spec.ts`).
