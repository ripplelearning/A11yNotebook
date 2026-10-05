// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { rotatedPage, taggedReport, untaggedReport } from './fixtures/pdf-fixtures';

type Probe = {
  name: string;
  result?: unknown;
  error?: unknown;
};

async function capture(name: string, call: () => unknown | Promise<unknown>): Promise<Probe> {
  try {
    return { name, result: await call() };
  } catch (error) {
    return { name, error };
  }
}

describe('PDF.js accessible-reading feasibility spike', () => {
  it('dumps raw API results for tagged, untagged, page-number, and rotated PDFs', async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    expect(pdfjs.version).toBe('6.4.299');
    const pageNumberBytes = untaggedReport(2);
    const fixtures = [
      { name: 'taggedReport.pdf', data: taggedReport() },
      { name: 'untaggedReport.pdf', data: untaggedReport(2) },
      { name: 'pageNumbers.pdf', data: pageNumberBytes },
      { name: 'rotated.pdf', data: rotatedPage() },
    ];
    const output: Record<string, unknown> = { pdfjsVersion: pdfjs.version };

    for (const fixture of fixtures) {
      const loadingTask = pdfjs.getDocument({
        data: fixture.data,
        useSystemFonts: false,
        verbosity: 0,
        enableXfa: false,
      });

      try {
        const doc = await loadingTask.promise;
        expect(doc.numPages).toBeGreaterThan(0);
        const page = await doc.getPage(1);
        const probes = await Promise.all([
          capture('doc.getPageLabels()', () => doc.getPageLabels()),
          capture('doc.getFingerprints()', () =>
            (doc as typeof doc & { getFingerprints: () => unknown }).getFingerprints(),
          ),
          capture('doc.getMetadata()', () => doc.getMetadata()),
          capture('doc.fingerprints', () => doc.fingerprints),
          capture('page.getTextContent({ includeMarkedContent: true })', () =>
            page.getTextContent({ includeMarkedContent: true }),
          ),
          capture('page.getStructTree()', () => page.getStructTree()),
          capture('page.getAnnotations()', () => page.getAnnotations()),
        ]);

        output[fixture.name] = { numPages: doc.numPages, probes };
        for (const probe of probes) {
          if (probe.name !== 'doc.getFingerprints()') {
            expect(probe.error, `${fixture.name}: ${probe.name}`).toBeUndefined();
          }
        }
      } catch (error) {
        output[fixture.name] = { error };
      } finally {
        await loadingTask.destroy();
      }
    }

    console.log(
      `PDFJS_SPIKE_RAW_OUTPUT_BEGIN\n${JSON.stringify(output, (_key, value: unknown) =>
        value instanceof Error ? { name: value.name, message: value.message } : value,
      )}\nPDFJS_SPIKE_RAW_OUTPUT_END`,
    );
    expect(Object.keys(output)).toHaveLength(fixtures.length + 1);
    for (const fixture of fixtures) {
      expect((output[fixture.name] as { error?: unknown }).error, fixture.name).toBeUndefined();
    }
  });
});
