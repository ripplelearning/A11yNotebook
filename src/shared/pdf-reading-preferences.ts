export interface PdfReadingPreferences {
  hideHeadersFooters: boolean;
  hidePageNumbers: boolean;
  /** Continuous view (the whole PDF as one scrolling page) is the default PDF view. */
  continuousView: boolean;
}

export const DEFAULT_PDF_READING_PREFERENCES: PdfReadingPreferences = Object.freeze({
  hideHeadersFooters: false,
  hidePageNumbers: false,
  continuousView: true,
});

export function validatePdfReadingPreferences(value: unknown): PdfReadingPreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid PDF reading preferences.');
  }
  const preferences = value as Partial<PdfReadingPreferences>;
  const keys = Reflect.ownKeys(value);
  // Stored preferences from before the view choice existed have only the
  // two hiding options; they keep working and open in Continuous view,
  // the new default.
  const isLegacy = keys.length === 2 && keys.includes('hideHeadersFooters') && keys.includes('hidePageNumbers');
  const isCurrent =
    keys.length === 3 &&
    keys.includes('hideHeadersFooters') &&
    keys.includes('hidePageNumbers') &&
    keys.includes('continuousView');
  if (
    !(isLegacy || isCurrent) ||
    typeof preferences.hideHeadersFooters !== 'boolean' ||
    typeof preferences.hidePageNumbers !== 'boolean' ||
    (preferences.continuousView !== undefined && typeof preferences.continuousView !== 'boolean')
  ) {
    throw new Error('Invalid PDF reading preferences.');
  }
  return {
    hideHeadersFooters: preferences.hideHeadersFooters,
    hidePageNumbers: preferences.hidePageNumbers,
    continuousView: preferences.continuousView ?? true,
  };
}
