import { describe, expect, it } from 'vitest';
import { notePositionFromHeadings } from '../shared/note-reading-position';

describe('notePositionFromHeadings', () => {
  it('returns null when no heading is at or above the viewport top', () => {
    expect(notePositionFromHeadings([{ text: 'Intro', top: 100 }])).toBeNull();
    expect(notePositionFromHeadings([])).toBeNull();
  });

  it('returns the last heading at or above the top', () => {
    expect(
      notePositionFromHeadings([
        { text: 'Intro', top: -40 },
        { text: 'Middle', top: 0 },
        { text: 'Later', top: 300 },
      ]),
    ).toEqual({ heading: 'Middle', occurrence: 0 });
  });

  it('counts occurrences of repeated heading text', () => {
    expect(
      notePositionFromHeadings([
        { text: 'Notes', top: -80 },
        { text: 'Other', top: -20 },
        { text: 'Notes', top: -5 },
        { text: 'End', top: 400 },
      ]),
    ).toEqual({ heading: 'Notes', occurrence: 1 });
  });

  it('skips blank headings without counting them', () => {
    expect(
      notePositionFromHeadings([
        { text: '   ', top: -50 },
        { text: 'Real', top: -10 },
      ]),
    ).toEqual({ heading: 'Real', occurrence: 0 });
  });
});
