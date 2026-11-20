// On-device OCR runtime: the Tesseract.js worker, core, and language
// data the renderer loads over the `ocr-data:` scheme.
//
// Why a custom scheme: the packaged renderer runs from file:// under a
// strict Content Security Policy (script-src 'self', connect-src 'self'),
// and Chromium blocks fetch() of file:// URLs, so the worker script, the
// WebAssembly core, and the trained data cannot load from plain files.
// `ocr-data:` is a privileged standard scheme (registered in
// electron/main.ts next to `vault-file:`), so fetch, importScripts, and
// WebAssembly streaming all work exactly like they would over https —
// with no network involved: every file is read from this computer.
//
// Layout of the runtime directory (ocr-runtime/, shipped with the app):
//   worker.min.js, tesseract-core-*.js, tesseract-core-*.wasm — the engine
//   lang/eng.traineddata.gz — English data, bundled
// Downloaded language data lives outside the app, in the user's data
// directory (ocr-lang/<code>.traineddata.gz), so it survives updates and
// is fetched once: the first OCR run in another language downloads that
// language's data (the dialog says so plainly), and later runs work
// offline.
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { app, ipcMain, protocol, type IpcMainInvokeEvent } from 'electron';
import { IPC_CHANNELS } from '../src/shared/ipc';
import {
  OCR_LANGUAGES,
  isOcrLanguageCode,
  ocrLanguageName,
  type OcrLanguageStatus,
} from '../src/shared/ocr';


/** Tesseract.js data package for a language, as its default URL builds it. */
function languageDownloadUrl(code: string): string {
  return `https://cdn.jsdelivr.net/npm/@tesseract.js-data/${code}/4.0.0_best_int/${code}.traineddata.gz`;
}

const MAX_LANGUAGE_DATA_BYTES = 40 * 1024 * 1024;

/** The bundled runtime directory: the repo in development, app resources when packaged. */
export function ocrRuntimeDir(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'ocr-runtime')
    : path.join(app.getAppPath(), 'ocr-runtime');
}

/** Where downloaded language data lives (per user-data directory). */
export function ocrLanguageCacheDir(): string {
  return path.join(app.getPath('userData'), 'ocr-lang');
}

function cachedLanguagePath(code: string): string {
  return path.join(ocrLanguageCacheDir(), `${code}.traineddata.gz`);
}

function bundledLanguagePath(code: string): string {
  return path.join(ocrRuntimeDir(), 'lang', `${code}.traineddata.gz`);
}

async function fileExists(target: string): Promise<boolean> {
  try {
    const stat = await lstat(target);
    return stat.isFile();
  } catch {
    return false;
  }
}

/** Whether a language's trained data is already on this computer. */
export async function isOcrLanguageReady(code: string): Promise<boolean> {
  if (!isOcrLanguageCode(code)) return false;
  return (await fileExists(cachedLanguagePath(code))) || (await fileExists(bundledLanguagePath(code)));
}

/** Every offered language with whether its data is already on disk. */
export async function listOcrLanguages(): Promise<OcrLanguageStatus[]> {
  const statuses: OcrLanguageStatus[] = [];
  for (const language of OCR_LANGUAGES) {
    statuses.push({ ...language, ready: await isOcrLanguageReady(language.code) });
  }
  return statuses;
}

/**
 * Make a language's data available, downloading it once when it is not
 * bundled or cached. The download is a plain file fetch of public
 * trained data: no document content is sent anywhere. Returns whether
 * the data is ready and whether this call downloaded it.
 */
export async function ensureOcrLanguage(code: string): Promise<{ ready: boolean; downloaded: boolean }> {
  if (!isOcrLanguageCode(code)) throw new Error(`Unknown OCR language: ${code}.`);
  if (await isOcrLanguageReady(code)) return { ready: true, downloaded: false };
  const target = cachedLanguagePath(code);
  await mkdir(ocrLanguageCacheDir(), { recursive: true });
  const response = await fetch(languageDownloadUrl(code), { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) {
    throw new Error(
      `The ${ocrLanguageName(code)} language data could not be downloaded (HTTP ${response.status}). Check the connection and try again.`,
    );
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_LANGUAGE_DATA_BYTES) {
    throw new Error(`The ${ocrLanguageName(code)} language data download was not usable. Try again.`);
  }
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) {
    throw new Error(`The ${ocrLanguageName(code)} language data download was not usable. Try again.`);
  }
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, bytes, { mode: 0o600 });
  try {
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
  return { ready: true, downloaded: true };
}

const RUNTIME_FILES = new Set([
  'worker.min.js',
  'tesseract-core-lstm.js',
  'tesseract-core-lstm.wasm',
  'tesseract-core-lstm.wasm.js',
  'tesseract-core-simd-lstm.js',
  'tesseract-core-simd-lstm.wasm',
  'tesseract-core-simd-lstm.wasm.js',
]);

const MIME_TYPES: Record<string, string> = {
  '.js': 'text/javascript',
  '.wasm': 'application/wasm',
  '.gz': 'application/gzip',
};

/**
 * Serve the OCR runtime over `ocr-data:`. Only the allowlisted engine
 * files and `<code>.traineddata.gz` language files are served, and every
 * path is resolved inside its directory — a `..` in the URL cannot
 * escape it. Language files are read from the download cache first, so
 * a downloaded language wins over a bundled one of the same name.
 */
export function setupOcrDataProtocol(): void {
  protocol.handle('ocr-data', async (request) => {
    try {
      const url = new URL(request.url);
      if (url.host !== 'ocr') return new Response('Not found.', { status: 404 });
      const segments = url.pathname.split('/').filter((segment) => segment.length > 0);
      if (segments[0] === 'runtime' && segments.length === 2 && RUNTIME_FILES.has(segments[1])) {
        const target = path.join(ocrRuntimeDir(), segments[1]);
        const bytes = await readFile(target);
        return new Response(new Uint8Array(bytes), {
          headers: {
            'Content-Type': MIME_TYPES[path.extname(target)] ?? 'application/octet-stream',
            'X-Content-Type-Options': 'nosniff',
            'Cache-Control': 'no-store',
          },
        });
      }
      if (segments[0] === 'lang' && segments.length === 2 && /^[a-z_]+[.]traineddata[.]gz$/.test(segments[1])) {
        const code = segments[1].replace(/\.traineddata\.gz$/, '');
        const cached = cachedLanguagePath(code);
        const target = (await fileExists(cached)) ? cached : bundledLanguagePath(code);
        const bytes = await readFile(target);
        return new Response(new Uint8Array(bytes), {
          headers: {
            'Content-Type': 'application/gzip',
            'X-Content-Type-Options': 'nosniff',
            'Cache-Control': 'no-store',
          },
        });
      }
      return new Response('Not found.', { status: 404 });
    } catch {
      return new Response('Not available.', { status: 404 });
    }
  });
}

/**
 * The language IPC: list what is ready, and download a language's data
 * on demand. The OCR save itself lives with the other privileged file
 * writes in electron/vault/ipc.ts, which owns the library service.
 */
export function setupOcrIpc(isTrustedSender: (event: IpcMainInvokeEvent) => boolean): void {
  ipcMain.handle(IPC_CHANNELS.vaultOcrLanguages, async (event) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted OCR request.');
    return listOcrLanguages();
  });
  ipcMain.handle(IPC_CHANNELS.vaultOcrEnsureLanguage, async (event, code: unknown) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted OCR request.');
    if (typeof code !== 'string') throw new Error('Invalid OCR language request.');
    return ensureOcrLanguage(code);
  });
}
