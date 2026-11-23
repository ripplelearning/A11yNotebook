import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';
import pkg from './package.json';

// A strict Content Security Policy for the packaged renderer. It is only injected
// into production builds because the Vite dev server relies on inline scripts
// for hot module replacement.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  // ocr-data: serves the on-device OCR runtime (Tesseract worker, core,
  // and language data) from this computer; see electron/ocr-runtime.ts.
  // 'wasm-unsafe-eval' lets the Tesseract WebAssembly core compile: it
  // allows WebAssembly compilation only, not eval() of JavaScript.
  // Without it the packaged app reports "OCR could not run" (1.9.21).
  "script-src 'self' ocr-data: 'wasm-unsafe-eval'",
  "style-src 'self'",
  // blob: for the same epubjs reason: images inside a section resolve
  // to blob: URLs, so a packaged ePub would show no pictures without it.
  "img-src 'self' data: vault-file: blob:",
  "font-src 'self'",
  // blob: lets epubjs render sections: every spine href resolves to a
  // blob: URL, loaded in an iframe and fetched as section content. The
  // packaged file:// page blocks both without it, so ePub sections show
  // "No extractable text" and OCR results have nowhere to display.
  "connect-src 'self' vault-file: ocr-data: blob:",
  // blob: lets Tesseract.js create its worker: createWorker builds the
  // worker from a blob URL (importScripts of the ocr-data: worker
  // script) by default. 'self' alone blocks blob: workers on the
  // packaged file:// page, so OCR could not start at all (1.9.21).
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  // blob: here too: epubjs renders each section in an iframe whose src
  // is the section's blob: URL (see connect-src above).
  "frame-src 'self' vault-file: blob:",
].join('; ');

function contentSecurityPolicy(): Plugin {
  return {
    name: 'a11y-notebook-csp',
    apply: 'build',
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: CONTENT_SECURITY_POLICY },
          injectTo: 'head',
        },
      ];
    },
  };
}

export default defineConfig({
  // Relative asset URLs so the packaged renderer resolves assets under file://.
  base: './',
  plugins: [react(), contentSecurityPolicy()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
    include: ['src/**/*.test.{ts,tsx}'],
    // GitHub's shared runners are slow enough that several heavy tests
    // (dialog renders, concurrent file writes) exceed the 5-second
    // default. Per-test timeouts kept missing newly slow tests, so the
    // suite default is 30 seconds; a genuinely hung test still fails,
    // just after 30 seconds instead of 5.
    testTimeout: 30_000,
  },
});
