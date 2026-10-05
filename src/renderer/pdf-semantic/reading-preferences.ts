import type { PdfReadingPreferences } from '../../shared/pdf-reading-preferences';

export type PdfArtifactType = 'header' | 'footer' | 'page-number';

export function explicitPdfArtifactType(tag?: string | null): PdfArtifactType | undefined {
  if (tag === 'Header') return 'header';
  if (tag === 'Footer') return 'footer';
  if (tag === 'PageNum') return 'page-number';
  return undefined;
}

const exposure = new WeakMap<HTMLElement, { ariaHidden: string | null }>();
const protectedSelector =
  'a[href], area[href], button, input, select, textarea, iframe, object, embed, audio[controls], video[controls], summary, [tabindex], [contenteditable]:not([contenteditable="false"]), [data-annotation-id], [data-annotation-description], [data-pdf-annotation]';

export function applyPdfReadingPreferences(root: HTMLElement, preferences: PdfReadingPreferences): void {
  const artifacts = [...root.querySelectorAll<HTMLElement>('[data-pdf-artifact-type]')];
  if (root.hasAttribute('data-pdf-artifact-type')) artifacts.unshift(root);
  for (const element of artifacts) {
    const type = element.dataset.pdfArtifactType;
    const active = element.ownerDocument.activeElement;
    const focusedRegion =
      active &&
      (element.contains(active) ||
        (active !== element.ownerDocument.body &&
          active !== element.ownerDocument.documentElement &&
          active.contains(element)));
    const shouldHide =
      (type === 'page-number'
        ? preferences.hidePageNumbers
        : (type === 'header' || type === 'footer') && preferences.hideHeadersFooters) &&
      !element.closest(protectedSelector) &&
      !element.querySelector(protectedSelector) &&
      !focusedRegion;
    const previous = exposure.get(element);
    if (shouldHide) {
      if (!previous) exposure.set(element, { ariaHidden: element.getAttribute('aria-hidden') });
      element.setAttribute('aria-hidden', 'true');
    } else if (previous) {
      if (previous.ariaHidden === null) element.removeAttribute('aria-hidden');
      else element.setAttribute('aria-hidden', previous.ariaHidden);
      exposure.delete(element);
    }
  }
}
