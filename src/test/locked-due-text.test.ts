import { describe, expect, it } from 'vitest';
import { lockedDueText } from '../shared/reminders';

describe('lockedDueText', () => {
  it('keeps the long-standing reminder-only wording', () => {
    expect(lockedDueText(['reminder'], 1)).toEqual({
      headline: 'A reminder is due.',
      detail: 'Unlock the library to view it.',
      waiting: '1 reminder waiting.',
      title: 'Reminder',
    });
    expect(lockedDueText(['reminder'], 3).headline).toBe('3 reminders are due.');
    expect(lockedDueText(['reminder'], 3).detail).toBe('Unlock the library to view them.');
  });

  it('names flashcards for flashcard-only batches without revealing content', () => {
    expect(lockedDueText(['flashcard'], 1)).toEqual({
      headline: 'A flashcard is due for review.',
      detail: 'Unlock the library to review it.',
      waiting: '1 flashcard waiting.',
      title: 'Flashcard review',
    });
    expect(lockedDueText(['flashcard'], 2).headline).toBe('2 flashcards are due for review.');
  });

  it('names both kinds for mixed batches', () => {
    expect(lockedDueText(['reminder', 'flashcard'], 2)).toEqual({
      headline: 'Reminders and flashcards are due.',
      detail: 'Unlock the library to view them.',
      waiting: 'Reminders and flashcards waiting.',
      title: 'Due reminders and flashcards',
    });
  });
});
