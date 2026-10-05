export interface PdfReadingPreferences {
  hideHeadersFooters: boolean;
  hidePageNumbers: boolean;
}

export const DEFAULT_PDF_READING_PREFERENCES: PdfReadingPreferences = Object.freeze({
  hideHeadersFooters: false,
  hidePageNumbers: false,
});

export function validatePdfReadingPreferences(value: unknown): PdfReadingPreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid PDF reading preferences.');
  }
  const preferences = value as Partial<PdfReadingPreferences>;
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== 2 ||
    !keys.includes('hideHeadersFooters') ||
    !keys.includes('hidePageNumbers') ||
    typeof preferences.hideHeadersFooters !== 'boolean' ||
    typeof preferences.hidePageNumbers !== 'boolean'
  ) {
    throw new Error('Invalid PDF reading preferences.');
  }
  return {
    hideHeadersFooters: preferences.hideHeadersFooters,
    hidePageNumbers: preferences.hidePageNumbers,
  };
}
