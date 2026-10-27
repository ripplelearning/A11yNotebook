/**
 * Pure note reading-position math: given the headings of the rendered
 * note in document order with their viewport tops, the reading position
 * is the last heading at or above the top of the viewport. Headings
 * below the top are never reached, so the scan stops at the first one.
 * The occurrence counts headings with identical text, so restoring can
 * pick the same heading when a note repeats a heading.
 */

export interface HeadingPosition {
  heading: string;
  occurrence: number;
}

export function notePositionFromHeadings(
  headings: readonly { text: string; top: number }[],
  viewportTop = 8,
): HeadingPosition | null {
  const counts = new Map<string, number>();
  let current: HeadingPosition | null = null;
  for (const heading of headings) {
    const text = heading.text.trim();
    if (!text) continue;
    const occurrence = counts.get(text) ?? 0;
    counts.set(text, occurrence + 1);
    if (heading.top <= viewportTop) {
      current = { heading: text, occurrence };
    } else {
      break;
    }
  }
  return current;
}
