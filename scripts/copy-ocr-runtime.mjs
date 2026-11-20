/**
 * Refresh the vendored Tesseract.js runtime in `ocr-runtime/` from the
 * installed packages, after a `tesseract.js` upgrade. Run from the repo
 * root: `node scripts/copy-ocr-runtime.mjs`.
 *
 * Copies:
 * - `worker.min.js` from `node_modules/tesseract.js/dist/`
 * - the LSTM core (js + wasm + wasm.js, plain and SIMD) from
 *   `node_modules/tesseract.js-core/` — the only core the app loads
 *   (OEM.LSTM_ONLY)
 * - `lang/eng.traineddata.gz` from the `@tesseract.js-data/eng` tarball
 *   (`4.0.0_best_int/`), the language data bundled so English OCR works
 *   offline with no download. Other languages download on first use.
 *
 * The download needs network access; everything else is a local copy.
 * After refreshing, re-run the OCR unit tests and the E2E OCR spec.
 */
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { get } from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'ocr-runtime');
mkdirSync(path.join(out, 'lang'), { recursive: true });

const worker = path.join(root, 'node_modules', 'tesseract.js', 'dist', 'worker.min.js');
if (!existsSync(worker)) throw new Error('tesseract.js is not installed; run npm install first.');
copyFileSync(worker, path.join(out, 'worker.min.js'));

const coreDir = path.join(root, 'node_modules', 'tesseract.js-core');
for (const file of [
  'tesseract-core-lstm.js',
  'tesseract-core-lstm.wasm',
  'tesseract-core-lstm.wasm.js',
  'tesseract-core-simd-lstm.js',
  'tesseract-core-simd-lstm.wasm',
  'tesseract-core-simd-lstm.wasm.js',
]) {
  const source = path.join(coreDir, file);
  if (!existsSync(source)) throw new Error(`Missing core file: ${source}`);
  copyFileSync(source, path.join(out, file));
}

const langOut = path.join(out, 'lang', 'eng.traineddata.gz');
if (!existsSync(langOut)) {
  const url = 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz';
  await new Promise((resolve, reject) => {
    get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Language data download failed: HTTP ${response.statusCode}`));
        return;
      }
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const bytes = Buffer.concat(chunks);
        if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) {
          reject(new Error('Downloaded language data is not gzip data.'));
          return;
        }
        writeFileSync(langOut, bytes);
        resolve(undefined);
      });
      response.on('error', reject);
    }).on('error', reject);
  });
}
