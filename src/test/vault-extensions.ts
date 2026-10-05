import { vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../shared/settings';

export function vaultExtensions() {
  return {
    move: vi.fn(),
    search: vi.fn(async () => []),
    getTags: vi.fn(async () => []),
    onChanged: vi.fn(() => () => undefined),
    getAnnotations: vi.fn(async () => []),
    addAnnotation: vi.fn(),
    updateAnnotation: vi.fn(),
    deleteAnnotation: vi.fn(async () => undefined),
    listPdfAnnotations: vi.fn(async () => []),
    addPdfAnnotation: vi.fn(),
    updatePdfAnnotation: vi.fn(),
    deletePdfAnnotation: vi.fn(async () => undefined),
    readAttachment: vi.fn(),
    getImageAlt: vi.fn(async () => ''),
    saveImageAlt: vi.fn(async () => undefined),
    getSettings: vi.fn(async () => DEFAULT_SETTINGS),
    saveSettings: vi.fn(async () => undefined),
    getReminders: vi.fn(async () => []),
    createReminder: vi.fn(async () => []),
    dismissReminder: vi.fn(async () => []),
    snoozeReminder: vi.fn(async () => []),
    onReminder: vi.fn(() => () => undefined),
    readAsset: vi.fn(),
    saveAsset: vi.fn(async () => undefined),
    createAsset: vi.fn(),
    getFlashcardSchedules: vi.fn(async () => ({})),
    saveFlashcardSchedule: vi.fn(async () => undefined),
    setHtmlTaskDueDate: vi.fn(async () => []),
  };
}
