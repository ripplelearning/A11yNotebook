// The packaged renderer's Content Security Policy must let the on-device
// OCR runtime load. The policy is injected into production builds only
// (vite.config.mts applies the CSP plugin on build), so the development
// server and the dev-mode end-to-end tests run with no CSP at all and
// cannot catch a policy that blocks OCR: in 1.9.21 OCR failed in the
// shipped build with "OCR could not run" while passing every dev test.
//
// What OCR needs from the policy:
// - worker-src must allow blob:: Tesseract.js creates its worker from a
//   blob URL by default (workerBlobURL: true), and 'self' alone blocks
//   blob: workers on the packaged file:// page.
// - script-src must allow 'wasm-unsafe-eval': the Tesseract WebAssembly
//   core cannot compile without it. That keyword allows WebAssembly
//   compilation only, not eval() of JavaScript strings.
// - script-src and connect-src must keep ocr-data:, the scheme the main
//   process serves the worker script, core, and language data over.
// - frame-src and connect-src must allow blob:: epubjs resolves every
//   spine href to a blob: URL, loaded in an iframe and fetched as section
//   content. Without blob: there, ePub sections show "No extractable
//   text" in the packaged build and an ePub OCR run recognizes text that
//   never appears in the reader.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function productionCsp(): string {
  const config = readFileSync('vite.config.mts', 'utf8');
  const match = config.match(/const CONTENT_SECURITY_POLICY = \[([\s\S]*?)\]\.join\('; '\);/);
  expect(match, 'vite.config.mts must define CONTENT_SECURITY_POLICY').not.toBeNull();
  return match?.[1] ?? '';
}

function directive(csp: string, name: string): string {
  const match = csp.match(new RegExp(`"${name} ([^"]*)"`));
  expect(match, `CSP must define a ${name} directive`).not.toBeNull();
  return match?.[1] ?? '';
}

describe('packaged Content Security Policy lets OCR run', () => {
  it('allows the Tesseract blob worker', () => {
    const workerSrc = directive(productionCsp(), 'worker-src');
    expect(workerSrc.split(' ')).toContain('blob:');
  });

  it('allows the Tesseract WebAssembly core to compile', () => {
    const scriptSrc = directive(productionCsp(), 'script-src');
    expect(scriptSrc.split(' ')).toContain("'wasm-unsafe-eval'");
    expect(scriptSrc.split(' ')).not.toContain("'unsafe-eval'");
  });

  it('keeps the on-device OCR scheme allowed for scripts and fetches', () => {
    const csp = productionCsp();
    expect(directive(csp, 'script-src').split(' ')).toContain('ocr-data:');
    expect(directive(csp, 'connect-src').split(' ')).toContain('ocr-data:');
  });

  it('lets epubjs render sections, so ePub OCR results have somewhere to display', () => {
    // epubjs resolves every spine href to a blob: URL, loaded in an
    // iframe and fetched as section content. Without blob: in both
    // directives the packaged build shows "No extractable text" for
    // every section, and an ePub OCR run recognizes text that never
    // appears in the reader.
    const csp = productionCsp();
    expect(directive(csp, 'frame-src').split(' ')).toContain('blob:');
    expect(directive(csp, 'connect-src').split(' ')).toContain('blob:');
    expect(directive(csp, 'img-src').split(' ')).toContain('blob:');
  });
});
