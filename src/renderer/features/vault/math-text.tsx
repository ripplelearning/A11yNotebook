import { Fragment, type ReactNode } from 'react';
import { asciiToMathML } from '../../../shared/ascii-math';
import { sanitizeNoteHtml } from './sanitize-html';

/**
 * Render math uniformly in plain text: a `math:<ascii>` marker or a raw
 * <math> element becomes rendered MathML, exactly as in Markdown and HTML
 * notes. Everything else stays a React text node, so nothing in the file
 * can become markup. A raw <math> element is re-sanitized first, and a
 * marker that does not parse stays literal text.
 */
const MATH_SEGMENT = /(`math:[^`]+`)|(<math[\s\S]*?<\/math>)/g;

export function renderMathSegments(line: string, keyPrefix: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let partIndex = 0;
  for (const match of line.matchAll(MATH_SEGMENT)) {
    const index = match.index ?? 0;
    if (index > lastIndex) parts.push(line.slice(lastIndex, index));
    const segment = match[0];
    let mathHtml: string | null = null;
    if (segment.startsWith('`math:')) {
      mathHtml = asciiToMathML(segment.slice('`math:'.length, -1));
    } else {
      const clean = sanitizeNoteHtml(segment);
      if (clean.includes('<math')) mathHtml = clean;
    }
    if (mathHtml) {
      parts.push(
        <span
          key={`${keyPrefix}-${partIndex}`}
          dangerouslySetInnerHTML={{ __html: mathHtml }}
        />,
      );
    } else {
      parts.push(segment);
    }
    partIndex += 1;
    lastIndex = index + segment.length;
  }
  if (lastIndex < line.length) parts.push(line.slice(lastIndex));
  if (parts.length === 0) parts.push(line);
  return parts.map((part, index) => <Fragment key={`${keyPrefix}-text-${index}`}>{part}</Fragment>);
}
