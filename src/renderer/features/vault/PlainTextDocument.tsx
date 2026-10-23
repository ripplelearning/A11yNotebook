import { Fragment } from 'react';

/**
 * Structured rendering for plain text: blank-line-separated blocks become
 * paragraphs and single line breaks are preserved, so the reading view is
 * navigable paragraph by paragraph instead of one unformatted block. All
 * text is rendered as React text nodes, so nothing in the file can become
 * markup.
 */
export default function PlainTextDocument({ text }: { text: string }) {
  const paragraphs = text
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
  if (paragraphs.length === 0) return <p>No readable text.</p>;
  return (
    <>
      {paragraphs.map((paragraph, index) => (
        <p key={index}>
          {paragraph.split('\n').map((line, lineIndex) => (
            <Fragment key={lineIndex}>
              {lineIndex > 0 ? <br /> : null}
              {line}
            </Fragment>
          ))}
        </p>
      ))}
    </>
  );
}
